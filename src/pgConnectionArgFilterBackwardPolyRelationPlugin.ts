import {
  SchemaBuilder,
  makePluginByCombiningPlugins,
  Build,
} from 'postgraphile';
import { GraphileBuild, PgPolymorphicConstraints, ResolveFieldFunc, PgPolymorphicConstraint } from './postgraphile_types';
import { PgClass } from 'graphile-build-pg';
import {
  validatePrerequisit, getPrimaryKey, polyForeignKeyUnique, polySqlKeyMatch,
} from './utils';
import {
  generateFilterResolveFunc,
  getTableFilterType,
} from './pgConnectionArgFilterForwardPolyRelationPlugin';
function makeResolveMany(build: Build, table: PgClass, foreignTable: PgClass) {
  const {
    inflection,
    connectionFilterResolve,
  } = build;
  const resolveMany: ResolveFieldFunc = ({
    sourceAlias, fieldValue, queryBuilder }) => {
    if (fieldValue == null) return null;

    const foreignTableFilterManyTypeName = inflection.filterManyPolyType(table, foreignTable);
    const sqlFragment = connectionFilterResolve(
      fieldValue,
      sourceAlias,
      foreignTableFilterManyTypeName,
      queryBuilder,
      null,
      null,
      null,
    );
    return sqlFragment == null ? null : sqlFragment;
  };
  return resolveMany;
}

const saveConnectionFilterTypesByTypename = (
  build: Build,
  table: PgClass,
  foreignTable: PgClass,
  constraint: PgPolymorphicConstraint,
  filterManyTypeName: string) => {
  const {
    connectionFilterTypesByTypeName,
    inflection,
    graphql: { GraphQLInputObjectType },
    newWithHooks,
  } = build;
  const foreignTableTypeName = inflection.tableType(foreignTable);
  if (!connectionFilterTypesByTypeName[filterManyTypeName]) {
    connectionFilterTypesByTypeName[filterManyTypeName] = newWithHooks(
      GraphQLInputObjectType,
      {
        name: filterManyTypeName,
        description: `A filter to be used against many \`${foreignTableTypeName}\` object
                 through polymorphic types. All fields are combined with a logical ‘and.’`,
      },
      {
        foreignTable,
        pgIntrospection: table,
        isPgConnectionFilterManyPoly: true,
        polyConstraint: constraint,
      },
    );
  }
  return connectionFilterTypesByTypeName[filterManyTypeName];
};
const addBackwardPolyManyFilter = (builder: SchemaBuilder) => {

  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      extend,
      newWithHooks,
      inflection,
      pgSql: sql,
      connectionFilterResolve,
      connectionFilterRegisterResolver,
      connectionFilterTypesByTypeName,
      connectionFilterType,
    } = build;
    const {
      fieldWithHooks,
      scope: {
        pgIntrospection: table,
        foreignTable, isPgConnectionFilterManyPoly,
        polyConstraint: constraint },
      Self,
    } = context;

    if (!isPgConnectionFilterManyPoly || !foreignTable) return fields;

    connectionFilterTypesByTypeName[Self.name] = Self;

    const foreignTableTypeName = inflection.tableType(foreignTable);
    const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
    const FilterType = connectionFilterType(
      newWithHooks,
      foreignTableFilterTypeName,
      foreignTable,
      foreignTableTypeName,
    );

    const manyFields = {
      every: fieldWithHooks(
        'every',
        {
          description: `Every related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘and.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
      some: fieldWithHooks(
        'some',
        {
          description: `Some related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘any.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
      none: fieldWithHooks(
        'none',
        {
          description: `No related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘none.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
    };
    const resolve: ResolveFieldFunc = ({ sourceAlias, fieldName, fieldValue, queryBuilder }) => {
      if (fieldValue == null) return null;

      const tablePrimaryKey = getPrimaryKey(table);

      const foreignTableAlias = sql.identifier(Symbol());

      const tableTypeName = inflection.tableType(table);
      const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);
      const sqlKeysMatch = polySqlKeyMatch(
        build, foreignTableAlias, sourceAlias, tablePrimaryKey, tableTypeName, constraint);

      const sqlSelectWhereKeysMatch = sql.query`select 1 from ${sqlIdentifier} as
        ${foreignTableAlias} where ${sqlKeysMatch}`;

      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );
      if (sqlFragment == null) {
        return null;
      }
      if (fieldName === 'every') {
        return sql.query`not exists(${sqlSelectWhereKeysMatch} and not (${sqlFragment}))`;
      }
      if (fieldName === 'some') {
        return sql.query`exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
      }
      if (fieldName === 'none') {
        return sql.query`not exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
      }
      throw new Error(`Unknown field name: ${fieldName}`);
    };

    for (const fieldName of Object.keys(manyFields)) {
      connectionFilterRegisterResolver(Self.name, fieldName, resolve);
    }

    return extend(fields, manyFields);
  });
};
const addBackwardPolySingleFilter = (builder: SchemaBuilder) => {
  // const { pgSimpleCollections } = option;
  // const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      inflection,
      pgOmit: omit,
      connectionFilterTypesByTypeName,
      pgPolymorphicClassAndTargetModels = [],
      connectionFilterRegisterResolver,
      extend,
    } = build as GraphileBuild;
    const {
      scope: { pgIntrospection: table, isPgConnectionFilter },
      fieldWithHooks,
      Self,
    } = context;

    if (!isPgConnectionFilter || table.kind !== 'class') return fields;

    validatePrerequisit(build as GraphileBuild);

    // let newFields = fields;
    connectionFilterTypesByTypeName[Self.name] = Self;
    const backwardRelationFields = (
      pgPolymorphicClassAndTargetModels as PgPolymorphicConstraints)
      .filter(con => con.to.find(c => c.pgClass.id === table.id))
      .reduce((acc, currentPoly) => {
        const foreignTable = currentPoly.from;
        if (!foreignTable || omit(foreignTable, 'read')) {
          return acc;
        }
        // const foreignTableTypeName = inflection.tableType(foreignTable);
        const isForeignKeyUnique = polyForeignKeyUnique(
          build as GraphileBuild, foreignTable, currentPoly);
        const fieldName = inflection.backwardRelationByPolymorphic(
          foreignTable,
          currentPoly,
          isForeignKeyUnique,
        );
        let resolveFunction: any = null;
        let filterType: any = null;
        if (isForeignKeyUnique) {
          filterType = getTableFilterType(build, foreignTable);
          resolveFunction = generateFilterResolveFunc(
            build as GraphileBuild, currentPoly, table, foreignTable, true);
        } else {
          const filterManyTypeName = inflection.filterManyPolyType(table, foreignTable);
          filterType = saveConnectionFilterTypesByTypename(build, table, foreignTable,
            currentPoly, filterManyTypeName);
          resolveFunction = makeResolveMany(build, table, foreignTable);
        }
        const singleField = {
          [fieldName]: fieldWithHooks(
            fieldName,
            {
              description: `Filter by the object’s \`${fieldName}\` polymorphic relation.`,
              type: filterType,
            },
            {
              isPgConnectionFilterField: true,
            },
          ),
        };
        // Resolver
        connectionFilterRegisterResolver(Self.name, fieldName, resolveFunction);
        return extend(acc, singleField);
      }, {});

    return extend(fields, backwardRelationFields);
  });
};

export const addBackwardPolyRelationFilter = makePluginByCombiningPlugins(
  addBackwardPolyManyFilter,
  addBackwardPolySingleFilter,
);

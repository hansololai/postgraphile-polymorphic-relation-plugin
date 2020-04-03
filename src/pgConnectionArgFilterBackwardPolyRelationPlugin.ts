import {
  SchemaBuilder,
  makePluginByCombiningPlugins,
} from 'postgraphile';
import { GraphileBuild, PgPolymorphicConstraints, ResolveFieldFunc } from './postgraphile_types';
import { PgClass } from 'graphile-build-pg';
import {
  validatePrerequisit, getPrimaryKey, polyForeignKeyUnique, polySqlKeyMatch,
} from './utils';
import {
  generateFilterResolveFunc,
  getTableFilterType,
} from './pgConnectionArgFilterForwardPolyRelationPlugin';

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
      // describePgEntity,
      newWithHooks,
      inflection,
      pgOmit: omit,
      // pgSql: sql,
      graphql: { GraphQLInputObjectType },
      connectionFilterResolve,
      connectionFilterTypesByTypeName,
      // connectionFilterType,
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
    function makeResolveMany(foreignTable: PgClass) {
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
        const foreignTableTypeName = inflection.tableType(foreignTable);
        const isForeignKeyUnique = polyForeignKeyUnique(
          build as GraphileBuild, foreignTable, currentPoly);
        const fieldName = inflection.backwardRelationByPolymorphic(
          foreignTable,
          currentPoly,
          isForeignKeyUnique,
        );
        if (isForeignKeyUnique) {
          const ForeignTableFilterType = getTableFilterType(build, foreignTable);
          const singleField = {
            [fieldName]: fieldWithHooks(
              fieldName,
              {
                description: `Filter by the object’s \`${fieldName}\` polymorphic relation.`,
                type: ForeignTableFilterType,
              },
              {
                isPgConnectionFilterField: true,
              },
            ),
          };
          const resolveSingle = generateFilterResolveFunc(
            build as GraphileBuild, currentPoly, table, foreignTable, true);
          // Resolver
          connectionFilterRegisterResolver(Self.name, fieldName, resolveSingle);
          return extend(acc, singleField);
        }
        // The association is not unique, inwhich case we make a ManyFilterType
        if (!omit(foreignTable, 'many')) {
          const filterManyTypeName = inflection.filterManyPolyType(table, foreignTable);
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
                polyConstraint: currentPoly,
              },
            );
          }
          const FilterManyType = connectionFilterTypesByTypeName[filterManyTypeName];

          // Field
          const manyField = {
            [fieldName]: fieldWithHooks(
              fieldName,
              {
                description: `Filter by the object’s \`${fieldName}\` relation.`,
                type: FilterManyType,
              },
              {
                isPgConnectionFilterField: true,
              },
            ),
          };
          // Relation spec for use in resolver
          // Resolver
          const resolve = makeResolveMany(foreignTable);
          connectionFilterRegisterResolver(Self.name, fieldName, resolve);
          return extend(acc, manyField);
        }
        return acc;
      }, {});

    return extend(fields, backwardRelationFields);
  });
};

export const addBackwardPolyRelationFilter = makePluginByCombiningPlugins(
  addBackwardPolyManyFilter,
  addBackwardPolySingleFilter,
);

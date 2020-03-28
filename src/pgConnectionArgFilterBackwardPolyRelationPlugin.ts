import { SchemaBuilder, Options, Build, Inflection } from 'postgraphile';
import { GraphileBuild, PgPolymorphicConstraint, PgPolymorphicConstraints } from './postgraphile_types';
import { GraphQLObjectType } from 'graphql';
import { QueryBuilder, PgClass, PgAttribute, SQL } from 'graphile-build-pg';
import { ForwardPolyRelationSpecType } from './pgConnectionArgFilterForwardPolyRelationPlugin';
import { validatePrerequisit, getPrimaryKey, polyForeignKeyUnique } from './utils';
export interface BackwardPolyRelationSpecType {
  table: PgClass;
  foreignTable: PgClass;
  fieldName: string;
  tablePrimaryKey: PgAttribute;
  constraint: PgPolymorphicConstraint;
  isOneToMany: boolean;
}

type SqlFragment = any;

export interface ResolveFieldProps {
  sourceAlias: SQL;
  fieldName: string;
  fieldValue: any;
  queryBuilder: QueryBuilder;
}
export type ResolveFieldFunc = (prop: ResolveFieldProps) => SqlFragment | null;

interface GetSqlSelectWhereKeysMatchProps {
  sourceAlias: SQL;
  foreignTableAlias: SQL;
  foreignTable: PgClass;
  table: PgClass;
  constraint: PgPolymorphicConstraint;
  tablePrimaryKey: PgAttribute;
  sql: any;
  inflection: Inflection;
}
const getSqlSelectWhereKeysMatch = ({
  sourceAlias,
  foreignTableAlias,
  foreignTable,
  table,
  constraint,
  tablePrimaryKey,
  sql,
  inflection,
}: GetSqlSelectWhereKeysMatchProps) => {
  const sourceTableId = `${constraint.name}_id`;
  const sourceTableType = `${constraint.name}_type`;
  const tableTypeName = inflection.tableType(table);
  const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);

  const sqlKeysMatch = sql.query`(${sql.fragment`${foreignTableAlias}.${sql.identifier(
    sourceTableId,
  )} = ${sourceAlias}.${sql.identifier(tablePrimaryKey.name)}`}) and (
  ${sql.fragment`${foreignTableAlias}.${sql.identifier(sourceTableType)} = ${sql.value(
    tableTypeName,
  )}`})`;
  const sqlSelectWhereKeysMatch = sql.query`select 1 from ${sqlIdentifier} as
  ${foreignTableAlias} where ${sqlKeysMatch}`;

  return sqlSelectWhereKeysMatch;
};
export const addField = (
  fieldName: string,
  description: string,
  type: GraphQLObjectType,
  resolve: ResolveFieldFunc,
  spec: BackwardPolyRelationSpecType | ForwardPolyRelationSpecType,
  hint: string,
  build: Build,
  fields: any,
  relationSpecByFieldName: {
    [x: string]: BackwardPolyRelationSpecType | ForwardPolyRelationSpecType,
  },
  context: any,
) => {
  const { extend, connectionFilterRegisterResolver } = build;
  const { fieldWithHooks, Self } = context;
  // Field
  const toReturn = extend(
    fields,
    {
      [fieldName]: fieldWithHooks(
        fieldName,
        {
          description,
          type,
        },
        {
          isPgConnectionFilterField: true,
        },
      ),
    },
    hint,
  );
  // Relation spec for use in resolver
  relationSpecByFieldName[fieldName] = spec;
  // Resolver
  connectionFilterRegisterResolver(Self.name, fieldName, resolve);
  return toReturn;
};
export const addBackwardPolyRelationFilter = (builder: SchemaBuilder, option: Options) => {
  // const { pgSimpleCollections } = option;
  // const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      describePgEntity,
      newWithHooks,
      inflection,
      pgOmit: omit,
      pgSql: sql,
      graphql: { GraphQLInputObjectType },
      connectionFilterResolve,
      connectionFilterTypesByTypeName,
      connectionFilterType,
      pgPolymorphicClassAndTargetModels = [],
    } = build as GraphileBuild;
    const {
      scope: { pgIntrospection: table, isPgConnectionFilter },
      Self,
    } = context;

    if (!isPgConnectionFilter || table.kind !== 'class') return fields;

    validatePrerequisit(build as GraphileBuild);

    let newFields = fields;
    connectionFilterTypesByTypeName[Self.name] = Self;

    const backwardRelationSpecs = (<PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter(con => con.to.find(c => c.pgClass.id === table.id))
      // .filter((con) => con.type === 'f')
      // .filter((con) => con.foreignClassId === table.id)
      .reduce(
        (memo, currentPoly) => {
          // if (omit(foreignConstraint, 'read')) {
          //   return memo;
          // }
          const foreignTable = currentPoly.from;
          if (!foreignTable) {
            return memo;
          }
          if (omit(foreignTable, 'read')) {
            return memo;
          }

          const primaryKey = getPrimaryKey(table);
          if (!primaryKey) {
            return memo;
          }
          const isForeignKeyUnique = polyForeignKeyUnique(
            build as GraphileBuild, foreignTable, currentPoly);

          const fieldName = inflection.backwardRelationByPolymorphic(
            foreignTable,
            currentPoly,
            isForeignKeyUnique,
          );

          memo.push({
            table,
            fieldName,
            foreignTable,
            tablePrimaryKey: primaryKey,
            isOneToMany: !isForeignKeyUnique,
            constraint: currentPoly,
          });
          return memo;
        },
        [] as BackwardPolyRelationSpecType[],
      );

    const backwardRelationSpecByFieldName: { [x: string]: BackwardPolyRelationSpecType } = {};

    const resolveSingle: ResolveFieldFunc = ({
      sourceAlias,
      fieldName,
      fieldValue,
      queryBuilder,
    }) => {
      if (fieldValue == null) return null;

      const { foreignTable, table, constraint, tablePrimaryKey,
      } = backwardRelationSpecByFieldName[fieldName];

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableAlias = sql.identifier(Symbol());

      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);

      const sqlSelectWhereKeysMatch = getSqlSelectWhereKeysMatch({
        sourceAlias,
        foreignTableAlias,
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
        sql,
        inflection,
      });

      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );
      return sqlFragment == null
        ? null
        : sql.query`exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
    };

    function makeResolveMany(backwardRelationSpec: BackwardPolyRelationSpecType) {
      const resolveMany: ResolveFieldFunc = ({
        sourceAlias, fieldName, fieldValue, queryBuilder }) => {
        if (fieldValue == null) return null;

        const { foreignTable } = backwardRelationSpecByFieldName[fieldName];

        const foreignTableFilterManyTypeName = inflection.filterManyPolyType(table, foreignTable);
        const sqlFragment = connectionFilterResolve(
          fieldValue,
          sourceAlias,
          foreignTableFilterManyTypeName,
          queryBuilder,
          null,
          null,
          null,
          { backwardRelationSpec },
        );
        return sqlFragment == null ? null : sqlFragment;
      };
      return resolveMany;
    }
    for (const spec of backwardRelationSpecs) {
      const { foreignTable, fieldName, isOneToMany } = spec;
      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
      const ForeignTableFilterType = connectionFilterType(
        newWithHooks,
        foreignTableFilterTypeName,
        foreignTable,
        foreignTableTypeName,
      );
      if (!ForeignTableFilterType) continue;

      if (isOneToMany) {
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
                isPgConnectionFilterManyPoly: true,
                backwardRelationSpec: spec,
              },
            );
          }
          const FilterManyType = connectionFilterTypesByTypeName[filterManyTypeName];
          newFields = addField(
            fieldName,
            `Filter by the object’s \`${fieldName}\` relation.`,
            FilterManyType,
            makeResolveMany(spec),
            spec,
            `Adding connection filter backward relation field from ${describePgEntity(
              table,
            )} to ${describePgEntity(foreignTable)}`,
            build,
            newFields,
            backwardRelationSpecByFieldName,
            context,
          );
        }
      } else {
        addField(
          fieldName,
          `Filter by the object’s \`${fieldName}\` relation.`,
          ForeignTableFilterType,
          resolveSingle,
          spec,
          `Adding connection filter backward relation field from ${describePgEntity(
            table,
          )} to ${describePgEntity(foreignTable)}`,
          build,
          newFields,
          backwardRelationSpecByFieldName,
          context,
        );
      }
    }

    return newFields;
  });

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
      scope: { foreignTable, isPgConnectionFilterManyPoly, backwardRelationSpec },
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
          description: `Some related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘and.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
      none: fieldWithHooks(
        'none',
        {
          description: `No related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘and.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
    };

    const resolve: ResolveFieldFunc = ({ sourceAlias, fieldName, fieldValue, queryBuilder }) => {
      if (fieldValue == null) return null;

      // foreignTable is the polymorphic table, like tags, notes,
      const {
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
      } = backwardRelationSpec as BackwardPolyRelationSpecType;
      const foreignTableAlias = sql.identifier(Symbol());
      const sqlSelectWhereKeysMatch = getSqlSelectWhereKeysMatch({
        sourceAlias,
        foreignTableAlias,
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
        sql,
        inflection,
      });
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

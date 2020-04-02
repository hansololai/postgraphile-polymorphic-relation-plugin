import { SchemaBuilder, Build } from 'postgraphile';
import {
  PgPolymorphicConstraints, GraphileBuild, PgPolymorphicConstraint,
} from './postgraphile_types';
import { ResolveFieldFunc } from './pgConnectionArgFilterBackwardPolyRelationPlugin';
import { validatePrerequisit, polySqlKeyMatch, getPrimaryKey } from './utils';
import { PgClass } from 'graphile-build-pg';

export const generateFilterResolveFunc = (
  build: GraphileBuild,
  poly: PgPolymorphicConstraint,
  sourceTable: PgClass,
  foreignTable: PgClass,
  foreignIsPoly: boolean,
) => {

  const {
    pgSql: sql,
    inflection,
    connectionFilterResolve,
  } = build;
  const foreignTableTypeName = inflection.tableType(foreignTable);
  const sourceTableTypeName = inflection.tableType(sourceTable);
  const foreignTableAlias = sql.identifier(Symbol());
  const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
  const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);

  const resolve: ResolveFieldFunc = ({
    sourceAlias,
    fieldValue,
    queryBuilder,
  }) => {
    if (fieldValue == null) return null;
    let sqlKeysMatch = '';
    if (foreignIsPoly) {
      // If foreign table is poly table, then we need to switch the alias
      const pKey = getPrimaryKey(sourceTable);
      sqlKeysMatch = polySqlKeyMatch(
        build, foreignTableAlias, sourceAlias, pKey, sourceTableTypeName, poly);
    } else {
      // If foreign table is not poly, means it is a regular table.
      const pKey = getPrimaryKey(foreignTable);
      sqlKeysMatch = polySqlKeyMatch(
        build, sourceAlias, foreignTableAlias, pKey, foreignTableTypeName, poly);
    }

    const sqlFragment = connectionFilterResolve(
      fieldValue,
      foreignTableAlias,
      foreignTableFilterTypeName,
      queryBuilder,
    );

    return sqlFragment == null
      ? null
      : sql.query` exists(
        select 1 from ${sqlIdentifier} as ${foreignTableAlias}
        where ${sqlKeysMatch} and
          (${sqlFragment})
      )`;
  };
  return resolve;
};

export const getTableFilterType = (build: Build, table: PgClass) => {
  const { newWithHooks, inflection, connectionFilterType } = build;
  const foreignTableTypeName = inflection.tableType(table);
  const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
  const ForeignTableFilterType = connectionFilterType(
    newWithHooks,
    foreignTableFilterTypeName,
    table,
    foreignTableTypeName,
  );
  return ForeignTableFilterType;
};

export const addForwardPolyRelationFilter = (builder: SchemaBuilder) => {
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      extend,
      inflection,
      connectionFilterTypesByTypeName,
      connectionFilterRegisterResolver,
      pgPolymorphicClassAndTargetModels = [],
    } = build as GraphileBuild;
    const {
      fieldWithHooks,
      scope: { pgIntrospection: table, isPgConnectionFilter },
      Self,
    } = context;

    if (!isPgConnectionFilter || table.kind !== 'class') return fields;
    validatePrerequisit(build as GraphileBuild);

    connectionFilterTypesByTypeName[Self.name] = Self;

    // Iterate the pgPolymorphic constraints and find the ones that are relavent to this table
    const forwardPolyRelationSpecs = (<PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter(con => con.from.id === table.id)
      .reduce((acc, currentPoly) => {
        const toReturn = currentPoly.to.reduce(
          (memo, curForeignTable) => {
            const { pgClass: foreignTable } = curForeignTable;
            const fName = inflection.forwardRelationByPolymorphic(
              foreignTable, currentPoly.name);

            const ForeignTableFilterType = getTableFilterType(build, foreignTable);
            if (!ForeignTableFilterType) return memo;

            // Field
            const resolve = generateFilterResolveFunc(
              build as GraphileBuild,
              currentPoly, table, foreignTable, false);
            connectionFilterRegisterResolver(Self.name, fName, resolve);
            return extend(memo, {
              [fName]: fieldWithHooks(
                fName,
                {
                  description: `Filter by the object’s \`${fName}\` polymorphic relation.`,
                  type: ForeignTableFilterType,
                },
                {
                  isPgConnectionFilterField: true,
                },
              ),
            });
          }, {});
        return extend(acc, toReturn);
      }, {});

    return extend(fields, forwardPolyRelationSpecs);
  });
};

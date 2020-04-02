import { SchemaBuilder, Build } from 'postgraphile';
import {
  PgPolymorphicConstraints, GraphileBuild, PgPolymorphicConstraint,
} from './postgraphile_types';
import { ResolveFieldFunc } from './pgConnectionArgFilterBackwardPolyRelationPlugin';
import { validatePrerequisit, polySqlKeyMatch } from './utils';
import { PgClass } from 'graphile-build-pg';

const generateFilterResolveFunc = (
  build: GraphileBuild,
  poly: PgPolymorphicConstraint,
  to: PgPolymorphicConstraint['to'][number],
) => {

  const { pKey, pgClass: foreignTable } = to;

  const {
    pgSql: sql,
    inflection,
    connectionFilterResolve,
  } = build;
  const foreignTableTypeName = inflection.tableType(foreignTable);
  const foreignTableAlias = sql.identifier(Symbol());
  const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
  const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);

  const resolve: ResolveFieldFunc = ({
    sourceAlias,
    fieldValue,
    queryBuilder,
  }) => {
    if (fieldValue == null) return null;

    const sqlKeysMatch = polySqlKeyMatch(
      build, sourceAlias, foreignTableAlias, pKey, foreignTableTypeName, poly);

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

const getTableFilterType = (build: Build, table: PgClass) => {
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

            const { fieldWithHooks, Self } = context;
            // Field
            const singleField = {
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
            };
            const resolve = generateFilterResolveFunc(build as GraphileBuild,
              currentPoly, curForeignTable);
            connectionFilterRegisterResolver(Self.name, fName, resolve);
            return extend(memo, singleField);
          }, {});
        return extend(acc, toReturn);
      }, {});

    return extend(fields, forwardPolyRelationSpecs);
  });
};

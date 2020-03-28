import { SchemaBuilder } from 'postgraphile';
import {
  PgPolymorphicConstraints, PgPolymorphicConstraint, GraphileBuild,
} from './postgraphile_types';
import { ResolveFieldFunc } from './pgConnectionArgFilterBackwardPolyRelationPlugin';
import { PgClass, PgAttribute } from 'graphile-build-pg';
import { validatePrerequisit, polySqlKeyMatch } from './utils';

export interface ForwardPolyRelationSpecType {
  table: PgClass;
  foreignTable: PgClass;
  fieldName: string;
  foreignPrimaryKey: PgAttribute;
  constraint: PgPolymorphicConstraint;
}

export const addForwardPolyRelationFilter = (builder: SchemaBuilder) => {
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      extend,
      newWithHooks,
      inflection,
      pgSql: sql,
      connectionFilterResolve,
      connectionFilterTypesByTypeName,
      connectionFilterType,
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
            const { pgClass: foreignTable, pKey } = curForeignTable;
            const fName = inflection.forwardRelationByPolymorphic(
              foreignTable, currentPoly.name);
            const resolve: ResolveFieldFunc = ({
              sourceAlias,
              fieldValue,
              queryBuilder,
            }) => {
              if (fieldValue == null) return null;

              const foreignTableTypeName = inflection.tableType(foreignTable);
              const foreignTableAlias = sql.identifier(Symbol());
              const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);
              const sqlKeysMatch = polySqlKeyMatch(
                build, sourceAlias, foreignTableAlias, pKey, foreignTableTypeName, currentPoly);

              const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);

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

            const foreignTableTypeName = inflection.tableType(foreignTable);
            const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
            const ForeignTableFilterType = connectionFilterType(
              newWithHooks,
              foreignTableFilterTypeName,
              foreignTable,
              foreignTableTypeName,
            );
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
            connectionFilterRegisterResolver(Self.name, fName, resolve);
            return extend(memo, singleField);
          }, {});
        return extend(acc, toReturn);
      }, {});

    return extend(fields, forwardPolyRelationSpecs);
  });
};

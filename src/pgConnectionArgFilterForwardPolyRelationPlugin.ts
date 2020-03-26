import { SchemaBuilder } from 'postgraphile';
import {
  PgPolymorphicConstraints, PgPolymorphicConstraint, GraphileBuild,
} from './postgraphile_types';
import { addField, ResolveFieldFunc } from './pgConnectionArgFilterBackwardPolyRelationPlugin';
import { PgClass, PgAttribute } from 'graphile-build-pg';
import { getPrimaryKey, validatePrerequisit } from './utils';

export interface ForwardPolyRelationSpecType {
  table: PgClass;
  foreignTable: PgClass;
  fieldName: string;
  foreignPrimaryKey: PgAttribute;
  constraint: PgPolymorphicConstraint;
}

function notNull<T>(v: T | null): v is T {
  if (!!v) return true;
  return false;
}
export const addForwardPolyRelationFilter = (builder: SchemaBuilder) => {
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      describePgEntity,
      newWithHooks,
      inflection,
      pgSql: sql,
      pgIntrospectionResultsByKind: { classById },
      connectionFilterResolve,
      connectionFilterTypesByTypeName,
      connectionFilterType,
      mapFieldToPgTable,
      pgPolymorphicClassAndTargetModels = [],
    } = build as GraphileBuild;
    const {
      scope: { pgIntrospection: table, isPgConnectionFilter },
      Self,
    } = context;
    let newFields = fields;

    if (!isPgConnectionFilter || table.kind !== 'class') return fields;
    validatePrerequisit(build as GraphileBuild);

    // A function convert the modelName to table.id
    const reFormatPolymorphicConstraint = (cur: PgPolymorphicConstraint) => {
      const newTo = cur.to
        .map((targetModelName) => {
          const t = mapFieldToPgTable[targetModelName];
          if (!t) {
            return null;
          }
          const c = classById[t.id];
          if (c.classKind !== 'r') {
            return null;
          }
          return c;
        }).filter(notNull)
        .map((r) => {
          return r.id;
        });
      return { ...cur, to: newTo };
    };

    connectionFilterTypesByTypeName[Self.name] = Self;

    // Iterate the pgPolymorphic constraints and find the ones that are relavent to this table
    const forwardPolyRelationSpecs: ForwardPolyRelationSpecType[]
      = (<PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
        .filter(con => con.from === table.id)
        .reduce((acc: ForwardPolyRelationSpecType[], currentPoly) => {
          const cur = reFormatPolymorphicConstraint(currentPoly);
          // For each polymorphic, we collect the following, using Tag as example
          // Suppose Tag can be tagged on User, Post via taggable_id and taggable_type
          // 1. target table objects. e.g. User, Post
          // 2. fieldNames e.g. UserAsTaggable, PostAsTaggable
          // 3. constraint name. e.g. taggable
          // 4. foreignTableAttribute e.g. 'id'
          const toReturn: ForwardPolyRelationSpecType[] = cur.to.reduce(
            (memo: ForwardPolyRelationSpecType[], curForeignTable) => {
              const foreignTable = classById[curForeignTable];
              if (!foreignTable) return memo;
              const fieldName = inflection.forwardRelationByPolymorphic(foreignTable, cur.name);
              const pKey = getPrimaryKey(foreignTable);
              if (pKey) {
                memo.push({
                  table,
                  foreignTable,
                  fieldName,
                  foreignPrimaryKey: pKey,
                  constraint: currentPoly,
                });
              }

              return memo;
            },
            [],
          );
          return [...acc, ...toReturn];
        }, []);

    const forwardPolyRelationSpecByFieldName: { [x: string]: ForwardPolyRelationSpecType } = {};
    const resolve: ResolveFieldFunc = ({
      sourceAlias,
      fieldName,
      fieldValue,
      queryBuilder,
    }) => {
      if (fieldValue == null) return null;

      const {
        foreignTable,
        foreignPrimaryKey,
        constraint,
      } = forwardPolyRelationSpecByFieldName[fieldName];

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableAlias = sql.identifier(Symbol());
      const sourceTableId = `${constraint.name}_id`;
      const sourceTableType = `${constraint.name}_type`;

      const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);
      // sql match query
      // sql string "(table_alias).xxx_type = 'User' and (table alias).xxx_id = (users alias).id"
      const sqlKeysMatch = sql.query`(${sql.fragment`${sourceAlias}.${sql.identifier(
        sourceTableId,
      )} = ${foreignTableAlias}.${sql.identifier(foreignPrimaryKey.name)}`}) and (
        ${sql.fragment`${sourceAlias}.${sql.identifier(sourceTableType)} = ${sql.value(
        foreignTableTypeName,
      )}`})`;

      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);

      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );

      return sqlFragment == null
        ? null
        : sql.query`\
      exists(
        select 1 from ${sqlIdentifier} as ${foreignTableAlias}
        where ${sqlKeysMatch} and
          (${sqlFragment})
      )`;
    };
    for (const spec of forwardPolyRelationSpecs) {
      const { foreignTable, fieldName } = spec;

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
      const ForeignTableFilterType = connectionFilterType(
        newWithHooks,
        foreignTableFilterTypeName,
        foreignTable,
        foreignTableTypeName,
      );
      if (!ForeignTableFilterType) continue;

      newFields = addField(
        fieldName,
        `Filter by the object’s \`${fieldName}\` polymorphic relation.`,
        ForeignTableFilterType,
        resolve,
        spec,
        `Adding connection filter forward polymorphic relation field from ${describePgEntity(
          table,
        )} to ${describePgEntity(foreignTable)}`,
        build,
        newFields,
        forwardPolyRelationSpecByFieldName,
        context,
      );
    }

    return newFields;
  });
};

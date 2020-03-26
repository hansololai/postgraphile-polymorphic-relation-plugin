import { SchemaBuilder, Options } from 'postgraphile';
import { PgClass } from 'graphile-build-pg';
import { GraphileBuild, PgPolymorphicConstraints } from './postgraphile_types';
import { validatePrerequisit, generateFieldWithHookFunc, polymorphicCondition, getPrimaryKey } from './utils';

export const addForwardPolyAssociation = (builder: SchemaBuilder, option: Options) => {
  builder.hook('inflection', inflection => ({
    ...inflection,
    forwardRelationByPolymorphic(table: PgClass, polymorphicName: string) {
      return this.camelCase(`${this.singularize(table.name)}-as-${polymorphicName}`);
    },
  }));
  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      extend,
      pgIntrospectionResultsByKind: { classById },
      inflection,
      mapFieldToPgTable,
      pgPolymorphicClassAndTargetModels,
    } = build as GraphileBuild;
    const {
      scope: { isPgRowType, pgIntrospection: table },
      fieldWithHooks,
    } = context;
    if (!isPgRowType || !table || table.kind !== 'class') {
      return fields;
    }
    validatePrerequisit(build as GraphileBuild);

    const forwardPolyRelationSpec = (
      <PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter(con => con.from === table.id)
      .reduce((memo, currentPoly) => {
        const { name } = currentPoly;
        const fieldsPerPolymorphicConstraint = currentPoly.to.reduce((acc, mName) => {
          const pgTableSimple = mapFieldToPgTable[mName];

          if (!pgTableSimple) return acc;
          const foreignTable = classById[pgTableSimple.id];
          const fieldName = `${inflection.forwardRelationByPolymorphic(foreignTable, name)}`;
          const foreignPrimaryKey = getPrimaryKey(foreignTable);
          if (!foreignPrimaryKey) return acc;
          const fieldFunction = generateFieldWithHookFunc(
            build as GraphileBuild,
            foreignTable,
            (qb1, qb2) => {
              qb2.where(polymorphicCondition(build as GraphileBuild,
                currentPoly, qb1, qb2, mName, foreignPrimaryKey));
            },
          );
          return {
            ...acc,
            [fieldName]: fieldWithHooks(
              fieldName,
              fieldFunction,
              {
                isPgForwardPolymorphicField: true,
                pgFieldIntrospection: foreignTable,
              },
            ), // scope
          };
        }, {});
        return extend(memo, fieldsPerPolymorphicConstraint);
      }, {});
    return extend(fields, forwardPolyRelationSpec);
  });
};

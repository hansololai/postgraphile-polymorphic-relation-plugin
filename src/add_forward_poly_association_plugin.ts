import { SchemaBuilder, Options } from 'postgraphile';
import { PgClass } from 'graphile-build-pg';
import { GraphileBuild, PgPolymorphicConstraints } from './postgraphile_types';
import {
  validatePrerequisit, generateFieldWithHookFunc, polymorphicCondition,
} from './utils';

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
      inflection,
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
      .filter(con => con.from.id === table.id)
      .reduce((memo, currentPoly) => {
        const { name } = currentPoly;
        const fieldsPerPolymorphicConstraint = currentPoly.to.reduce((acc, polyC) => {
          const { pgClass: foreignTable,
            name: mName,
            pKey: foreignPrimaryKey } = polyC;
          const fieldName = `${inflection.forwardRelationByPolymorphic(foreignTable, name)}`;
          const fieldFunction = generateFieldWithHookFunc(
            build as GraphileBuild,
            foreignTable,
            (qb1, qb2) => {
              qb2.where(polymorphicCondition(build as GraphileBuild,
                currentPoly, qb1, qb2, mName, foreignPrimaryKey));
            },
            fieldName,
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

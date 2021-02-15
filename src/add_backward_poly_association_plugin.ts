import { SchemaBuilder, Options } from 'postgraphile';
import {
  GraphileBuild, PgPolymorphicConstraints,
} from './postgraphile_types';
import {
  validatePrerequisit, polyForeignKeyUnique, generateFieldWithHookFunc,
  polymorphicCondition, getPrimaryKey, ensureBuilderUniqueOrder,
} from './utils';

export const addBackwardPolyAssociation = (builder: SchemaBuilder, option: Options) => {

  // const { pgSimpleCollections } = option;
  // const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      extend,
      inflection,
      pgOmit: omit,
      pgPolymorphicClassAndTargetModels,
    } = build as GraphileBuild;
    const {
      scope: { isPgRowType, pgIntrospection: table },
      fieldWithHooks,
      // Self,
    } = context;
    if (!isPgRowType || !table || table.kind !== 'class') {
      return fields;
    }
    const tablePKey = getPrimaryKey(table);
    if (!tablePKey) {
      return fields;
    }
    validatePrerequisit(build as GraphileBuild);

    const modelName = inflection.tableType(table);
    // Find  all the forward relations with polymorphic
    const isConnection = true;

    const backwardPolyAssociation = (<PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter(con => con.to.find(c => c.pgClass.id === table.id))
      .reduce((memo, currentPoly) => {
        // const { name } = currentPoly;
        const foreignTable = currentPoly.from;
        if (omit(foreignTable, 'read')) {
          return memo;
        }
        const isForeignKeyUnique = polyForeignKeyUnique(build as GraphileBuild,
          foreignTable, currentPoly);
        const fieldName = inflection.backwardRelationByPolymorphic(
          foreignTable,
          currentPoly,
          isForeignKeyUnique,
        );

        const fieldFunction = generateFieldWithHookFunc(
          build as GraphileBuild,
          foreignTable,
          (qBuilder, innerBuilder) => {
            innerBuilder.where(polymorphicCondition(build as GraphileBuild,
              currentPoly, innerBuilder, qBuilder, modelName, tablePKey));
            if (!isForeignKeyUnique) {
              ensureBuilderUniqueOrder(build, innerBuilder, foreignTable);
            }
          },
          fieldName,
          isForeignKeyUnique,
          isConnection,
        );
        return {
          ...memo,
          [fieldName]: fieldWithHooks(
            fieldName,
            fieldFunction,
            {
              isPgFieldConnection: isConnection,
              isPgFieldSimpleCollection: !isConnection,
              isPgBackwardPolymorphicField: true,
              pgFieldIntrospection: foreignTable,
            },
          ),
        };
      }, {});
    return extend(fields, backwardPolyAssociation);
  });
};

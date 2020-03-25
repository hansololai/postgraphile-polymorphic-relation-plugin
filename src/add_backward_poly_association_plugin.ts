import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild, PgPolymorphicConstraint, PgPolymorphicConstraints } from './postgraphile_types';
import { PgClass } from 'graphile-build-pg';
import {
  validatePrerequisit, polyForeignKeyUnique, generateFieldWithHookFunc,
  polymorphicCondition, getPrimaryKey,
} from './utils';

export const addBackwardPolyAssociation = (builder: SchemaBuilder, option: Options) => {
  // First add an inflector for polymorphic backrelation type name
  builder.hook('inflection', inflection => ({
    ...inflection,
    backwardRelationByPolymorphic(
      table: PgClass,
      polyConstraint: PgPolymorphicConstraint,
      isUnique: boolean,
    ) {
      const { backwardAssociationName } = polyConstraint;
      const name = backwardAssociationName || table.name;
      const fieldName = isUnique ? this.singularize(name) : this.pluralize(name);
      // return this.camelCase(`${fieldName}-as-${polymorphicName}`);
      return this.camelCase(fieldName);
    },
  }));
  // const { pgSimpleCollections } = option;
  // const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      extend,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgSql: sql,
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
    validatePrerequisit(build as GraphileBuild);

    const modelName = inflection.tableType(table);
    // Find  all the forward relations with polymorphic
    const isConnection = true;
    const backwardPolyAssociation = (<PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter((con) => {
        return con.to.includes(modelName);
      })
      .reduce((memo, currentPoly) => {
        // const { name } = currentPoly;
        const foreignTable = introspectionResultsByKind.classById[currentPoly.from];
        if (omit(foreignTable, 'read')) {
          return memo;
        }
        const tablePKey = getPrimaryKey(build as GraphileBuild, table);
        const isForeignKeyUnique = polyForeignKeyUnique(build as GraphileBuild,
          foreignTable, currentPoly);
        const fieldName = inflection.backwardRelationByPolymorphic(
          foreignTable,
          currentPoly,
          isForeignKeyUnique,
        );
        if (!tablePKey) {
          return memo;
        }
        const fieldFunction = generateFieldWithHookFunc(
          build as GraphileBuild,
          foreignTable,
          (qBuilder, innerBuilder) => {
            innerBuilder.where(polymorphicCondition(build as GraphileBuild,
              currentPoly, innerBuilder, qBuilder, modelName, tablePKey));
            if (!isForeignKeyUnique) {
              innerBuilder.beforeLock('orderBy', () => {
                // append order by primary key to the list of orders
                if (!innerBuilder.isOrderUnique(false)) {
                  (innerBuilder as any).data.cursorPrefix = ['primary_key_asc'];
                  if (foreignTable.primaryKeyConstraint) {
                    const fPrimaryKeys =
                      foreignTable.primaryKeyConstraint.keyAttributes;
                    fPrimaryKeys.forEach((key) => {
                      innerBuilder.orderBy(
                        sql.fragment`${innerBuilder.getTableAlias()}.
                      ${sql.identifier(key.name)}`,
                        true,
                      );
                    });
                  }
                }
                innerBuilder.setOrderIsUnique();
              });
            }
          },
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

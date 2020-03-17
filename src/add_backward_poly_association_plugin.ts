import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild } from 'postgraphile-plugin-connection-filter-polymorphic/dist/postgraphile_types';
import { QueryBuilder, PgClass } from 'graphile-build-pg';
import { PgPolymorphicConstraints, PgPolymorphicConstraint } from 'postgraphile-plugin-connection-filter-polymorphic';

import { canonical } from './utils';

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
      getTypeByName,
      pgGetGqlTypeByTypeIdAndModifier,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgSql: sql,
      getSafeAliasFromResolveInfo,
      getSafeAliasFromAlias,
      graphql: { GraphQLNonNull, GraphQLList },
      inflection,
      pgQueryFromResolveData: queryFromResolveData,
      pgOmit: omit,
      // describePgEntity,
      // mapFieldToPgTable,
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
    // error out if this is not defined, this plugin depend on another plugin.
    if (!Array.isArray(pgPolymorphicClassAndTargetModels)) {
      throw new Error(`The pgPolymorphicClassAndTargetModels is not defined,
      you need to use addModelTableMappingPlugin and definePolymorphicCustom before this`);
    }
    const modelName = inflection.tableType(table);
    // console.log(pgPolymorphicClassAndTargetModels);
    // Find  all the forward relations with polymorphic
    const isConnection = true;
    const backwardPolyAssociation = (<PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter(con => {
        const r = con.to.map(canonical).includes(canonical(modelName))
       
        return r;
      })
      .reduce((memo, currentPoly) => {
        // const { name } = currentPoly;
        const foreignTable = introspectionResultsByKind.classById[currentPoly.from];
        if (!foreignTable) {
          return memo;
          // throw new Error(
          //   `Could not find the foreign table (polymorphicName: ${currentPoly.name})`,
          // );
        }
        if (omit(foreignTable, 'read')) {
          return memo;
        }
        const primaryConstraint = introspectionResultsByKind.constraint.find(
          attr => attr.classId === table.id && attr.type === 'p',
        );
        const primaryAttribute = primaryConstraint && primaryConstraint.keyAttributes;
        const sourceTableId = `${currentPoly.name}_id`;
        const sourceTableType = `${currentPoly.name}_type`;
        const isForeignKeyUnique = introspectionResultsByKind.constraint.find((c) => {
          if (c.classId !== foreignTable.id) return false;
          // Only if the xxx_type, xxx_id are unique constraint
          if (c.keyAttributeNums.length !== 2) return false;
          // It must be an unique constraint
          if (c.type !== 'u') return false;
          // the two attributes must be xx_type, xx_id
          if (!c.keyAttributes.find(a => a.name === sourceTableId)) return false;
          if (!c.keyAttributes.find(a => a.name === sourceTableType)) return false;
          return true;
        });
        const fieldName = inflection.backwardRelationByPolymorphic(
          foreignTable,
          currentPoly,
          isForeignKeyUnique,
        );
        // const fieldName = isForeignKeyUnique
        //   ? `${inflection.camelCase(inflection.singularize(foreignTable.name))}`
        //   : `${inflection.camelCase(inflection.pluralize(foreignTable.name))}`;
        const foreignTableType = pgGetGqlTypeByTypeIdAndModifier(foreignTable.type.id, null);
        const foreignTableConnectionType = getTypeByName(
          inflection.connection(foreignTableType.name),
        );
        if (!primaryAttribute || primaryAttribute.length < 1) {
          return memo;
        }

        return {
          ...memo,
          [fieldName]: fieldWithHooks(
            fieldName,
            (p: any) => {
              const { getDataFromParsedResolveInfoFragment, addDataGenerator } = p;
              addDataGenerator((parsedResolveInfoFragment: any) => {
                return {
                  pgQuery: (queryBuilder: QueryBuilder) => {
                    queryBuilder.select(() => {
                      const resolveData = getDataFromParsedResolveInfoFragment(
                        parsedResolveInfoFragment,
                        !isForeignKeyUnique && isConnection
                          ? foreignTableConnectionType
                          : foreignTableType,
                      );
                      const foreignTableAlis = sql.identifier(Symbol());
                      const tableAlias = queryBuilder.getTableAlias();
                      const queryOptions = isForeignKeyUnique
                        ? {
                          useAsterisk: false, // Because it's only a single relation, no need
                          asJson: true,
                          addNullCase: true,
                          withPagination: false,
                        }
                        : {
                          useAsterisk: table.canUseAsterisk,
                          withPagination: isConnection,
                          withPaginationAsFields: false,
                          asJsonAggregate: !isConnection,
                        };
                      const query = queryFromResolveData(
                        sql.identifier(foreignTable.namespace.name, foreignTable.name),
                        foreignTableAlis,
                        resolveData,
                        queryOptions,
                        (innerQueryBuilder: any) => {
                          innerQueryBuilder.parentQueryBuilder = queryBuilder;
                          innerQueryBuilder.where(
                            sql.query`(${sql.fragment`${tableAlias}.${sql.identifier(
                              primaryAttribute[0].name,
                            )} = ${sql.fragment`${foreignTableAlis}.${sql.identifier(
                              sourceTableId,
                            )}`}`}) and (
                              ${sql.fragment`${foreignTableAlis}.${sql.identifier(
                              sourceTableType,
                            )} = ${sql.value(modelName)}`})`,
                          );
                          if (!isForeignKeyUnique) {
                            innerQueryBuilder.beforeLock('orderBy', () => {
                              // append order by primary key to the list of orders
                              if (!innerQueryBuilder.isOrderUnique(false)) {
                                innerQueryBuilder.data.cursorPrefix = ['primary_key_asc'];
                                if (foreignTable.primaryKeyConstraint) {
                                  const fPrimaryKeys =
                                    foreignTable.primaryKeyConstraint.keyAttributes;
                                  fPrimaryKeys.forEach((key) => {
                                    innerQueryBuilder.orderBy(
                                      sql.fragment`${innerQueryBuilder.getTableAlias()}.
                                  ${sql.identifier(key.name)}`,
                                      true,
                                    );
                                  });
                                }
                              }
                              innerQueryBuilder.setOrderIsUnique();
                            });
                          }
                        },
                      );
                      return sql.fragment`(${query})`;
                    }, getSafeAliasFromAlias(parsedResolveInfoFragment.alias));
                  },
                };
              });
              return {
                description: `Backward relation of \`${foreignTableType.name}\`.`,
                // type: new GraphQLNonNull(RightTableType),
                // This maybe should be nullable? because polymorphic foreign key
                // is not constraint
                type: isForeignKeyUnique
                  ? foreignTableType
                  : isConnection
                    ? new GraphQLNonNull(foreignTableConnectionType)
                    : new GraphQLList(new GraphQLNonNull(foreignTableType)),
                args: {},
                resolve: (data: any, _args: any, _context: any, resolveInfo: any) => {
                  const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
                  const record = data[safeAlias];
                  // const liveRecord = resolveInfo.rootValue && resolveInfo.rootValue.liveRecord;
                  // if (record && liveRecord) {
                  //   liveRecord('pg', table, record.__identifiers);
                  // }
                  return record;
                },
              };
            },
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

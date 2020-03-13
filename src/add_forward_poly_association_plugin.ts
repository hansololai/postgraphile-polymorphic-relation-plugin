import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild } from 'postgraphile-plugin-connection-filter-polymorphic/dist/postgraphile_types';
import { PgPolymorphicConstraints } from 'postgraphile-plugin-connection-filter-polymorphic'
import { QueryBuilder } from 'graphile-build-pg';
import { IGraphQLToolsResolveInfo } from 'graphql-tools';


export const addForwardPolyAssociation = (builder: SchemaBuilder, option: Options) => {
  // const { pgSimpleCollections } = option;
  // const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      extend,
      pgGetGqlTypeByTypeIdAndModifier,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgSql: sql,
      getSafeAliasFromResolveInfo,
      getSafeAliasFromAlias,
      inflection,
      pgQueryFromResolveData: queryFromResolveData,
      mapFieldToPgTable,
      pgPolymorphicClassAndTargetModels = [],
    } = build as GraphileBuild;
    const {
      scope: { isPgRowType, pgIntrospection: table },
      fieldWithHooks,
    } = context;
    if (!isPgRowType || !table || table.kind !== 'class') {
      return fields;
    }
    // error out if this is not defined, this plugin depend on another plugin.
    if (!Array.isArray(pgPolymorphicClassAndTargetModels)) {
      throw new Error(`The pgPolymorphicClassAndTargetModels is not defined, 
      you need to use addModelTableMappingPlugin and definePolymorphicCustom before this`);
    }

    // console.log(pgPolymorphicClassAndTargetModels);
    // Find  all the forward relations with polymorphic
    const forwardPolyRelationSpec = (
      <PgPolymorphicConstraints>pgPolymorphicClassAndTargetModels)
      .filter(con => con.from === table.id)
      .reduce((memo, currentPoly) => {
        const { name } = currentPoly;
        const sourceTableId = `${name}_id`;
        const sourceTableType = `${name}_type`;
        const fieldsPerPolymorphicConstraint = currentPoly.to.reduce((acc, mName) => {
          const pgTableSimple = mapFieldToPgTable[mName];
          if (!pgTableSimple) return acc;
          const foreignTable = introspectionResultsByKind.classById[pgTableSimple.id];
          const fieldName = `${inflection.forwardRelationByPolymorphic(foreignTable, name)}`;
          const foreignPrimaryConstraint = introspectionResultsByKind.constraint.find(
            attr => attr.classId === foreignTable.id && attr.type === 'p',
          );
          if (!foreignPrimaryConstraint) {
            return acc;
          }
          const foreignPrimaryKey = foreignPrimaryConstraint.keyAttributes[0];
          const rightTableTypeName = inflection.tableType(foreignTable);
          const RightTableType = pgGetGqlTypeByTypeIdAndModifier(
            foreignTable.type.id,
            null,
          );

          if (!RightTableType) {
            throw new Error(
              `Could not determine type for table with id ${foreignTable.id}`,
            );
          }
          return {
            ...acc,
            [fieldName]: fieldWithHooks(
              fieldName,
              ({ getDataFromParsedResolveInfoFragment, addDataGenerator }: any) => {
                addDataGenerator((parsedResolveInfoFragment: any) => {
                  return {
                    pgQuery: (queryBuilder: QueryBuilder) => {
                      queryBuilder.select(() => {
                        const resolveData = getDataFromParsedResolveInfoFragment(
                          parsedResolveInfoFragment,
                          RightTableType,
                        );
                        const rightTableAlias = sql.identifier(Symbol());
                        const leftTableAlias = queryBuilder.getTableAlias();
                        const query = queryFromResolveData(
                          sql.identifier(
                            foreignTable.namespace.name,
                            foreignTable.name,
                          ),
                          rightTableAlias,
                          resolveData,
                          {
                            useAsterisk: false, // Because it's only a single relation, no need
                            asJson: true,
                            addNullCase: true,
                            withPagination: false,
                          },
                          (innerQueryBuilder: any) => {
                            innerQueryBuilder.parentQueryBuilder = queryBuilder;
                            innerQueryBuilder.where(
                              sql.query`(${sql.fragment`${rightTableAlias}.${sql.identifier(
                                foreignPrimaryKey.name,
                              )} = ${sql.fragment`${leftTableAlias}.${sql.identifier(
                                sourceTableId,
                              )}`}`}) and (
                              ${sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(
                                sourceTableType,
                              )} = ${sql.value(mName)}`})`,
                            );
                          },
                        );
                        return sql.fragment`(${query})`;
                      }, getSafeAliasFromAlias(parsedResolveInfoFragment.alias));
                    },
                  };
                });
                return {
                  description: `Reads through a \`${rightTableTypeName}\`.`,
                  // type: new GraphQLNonNull(RightTableType),
                  // This maybe should be nullable? because polymorphic foreign key
                  // is not constraint
                  type: RightTableType,
                  args: {},
                  resolve: (data: any,
                    _args: any,
                    _context: any,
                    resolveInfo: IGraphQLToolsResolveInfo) => {
                    const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
                    // return null;
                    return data[safeAlias];
                  },
                };
              },
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

import { GraphileBuild, PgPolymorphicConstraint } from './postgraphile_types';
import { QueryBuilder, PgClass, PgAttribute } from 'graphile-build-pg';
import { IGraphQLToolsResolveInfo } from 'graphql-tools';

export function canonical(str: string): string {
  const m = str.match(/\w+$/);
  return (m && m[0]) || str;
}

export const validatePrerequisit = (
  build: GraphileBuild,
) => {
  const {
    pgPolymorphicClassAndTargetModels,
    mapFieldToPgTable,
  } = build;
  if (!Array.isArray(pgPolymorphicClassAndTargetModels) || !mapFieldToPgTable) {
    throw new Error(`The pgPolymorphicClassAndTargetModels or mapFieldToPgTable is not defined,
    you need to use addModelTableMappingPlugin and definePolymorphicCustom before this`);
  }
};

export const getSourceColumns = (c: PgPolymorphicConstraint) => {
  const { name } = c;
  return {
    sourceTableId: `${name}_id`,
    sourceTableType: `${name}_type`,
  };
};
export const isPolymorphicColumn = (attr: PgAttribute) => {
  return ['r', 'v', 'm'].includes(attr.class.classKind)
    && attr.name.endsWith('_type') && !!attr.tags.isPolymorphic;
};
export const columnToPolyConstraint = (attr: PgAttribute) => {
  const {
    name,
    tags: { polymorphicTo = [], isPolymorphic },
  } = attr;
  let targetTables: string[] = [];
  if (typeof polymorphicTo === 'string') {
    targetTables = [canonical(polymorphicTo)];
  } else if (Array.isArray(polymorphicTo)) {
    targetTables = polymorphicTo.map(canonical);
  }
  targetTables = Array.from(new Set<string>(targetTables));
  const polymorphicKey = name.substring(0, name.length - 5);
  const newPolyConstraint: PgPolymorphicConstraint = {
    name: polymorphicKey,
    from: attr.classId,
    to: targetTables,
  };
  if (typeof isPolymorphic === 'string') {
    // There is a backward association name for this
    newPolyConstraint.backwardAssociationName = isPolymorphic;
  }
  return newPolyConstraint;
};

export const generateFieldWithHookFunc = (
  build: GraphileBuild,
  innerTable: PgClass,
  joinCallback: (qb1: QueryBuilder, qb2: QueryBuilder) => void,
  isUnique: boolean = true,
  isConnection: boolean = false,
) => {
  const {
    pgSql: sql,
    graphql: { GraphQLNonNull, GraphQLList },
    pgGetGqlTypeByTypeIdAndModifier,
    pgQueryFromResolveData: queryFromResolveData,
    getSafeAliasFromAlias,
    getSafeAliasFromResolveInfo,
    inflection,
    getTypeByName,
  } = build;
  const innerTableType = pgGetGqlTypeByTypeIdAndModifier(
    innerTable.type.id,
    null,
  );
  const innerTableConnectionType = getTypeByName(
    inflection.connection(innerTable.name),
  );
  let returnType = innerTableType;
  let fieldType = innerTableType;
  if (!isUnique) {
    if (isConnection) {
      returnType = innerTableConnectionType;
      fieldType = new GraphQLNonNull(innerTableConnectionType);
    } else {
      // using simple connection
      fieldType = new GraphQLList(new GraphQLNonNull(innerTableConnectionType));
    }
  }
  const rightTableTypeName = inflection.tableType(innerTable);

  return ({ getDataFromParsedResolveInfoFragment, addDataGenerator }: any) => {
    addDataGenerator((parsedResolveInfoFragment: any) => {
      return {
        pgQuery: (queryBuilder: QueryBuilder) => {
          queryBuilder.select(() => {
            const resolveData = getDataFromParsedResolveInfoFragment(
              parsedResolveInfoFragment,
              returnType,
            );
            const queryOptions = isUnique
              ? {
                useAsterisk: false, // Because it's only a single relation, no need
                asJson: true,
                addNullCase: true,
                withPagination: false,
              }
              : {
                useAsterisk: innerTable.canUseAsterisk,
                withPagination: isConnection,
                withPaginationAsFields: false,
                asJsonAggregate: !isConnection,
              };
            const innerTableAlias = sql.identifier(Symbol());
            const query = queryFromResolveData(
              sql.identifier(
                innerTable.namespace.name,
                innerTable.name,
              ),
              innerTableAlias,
              resolveData,
              queryOptions,
              (innerQueryBuilder: any) => {
                innerQueryBuilder.parentQueryBuilder = queryBuilder;
                joinCallback(queryBuilder, innerQueryBuilder);
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
      type: fieldType,
      args: {},
      resolve: (
        data: any, _args: any, _context: any,
        resolveInfo: IGraphQLToolsResolveInfo) => {
        const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
        // return null;
        return data[safeAlias];
      },
    };
  };
};
export const getPrimaryKey = (
  table: PgClass) => {
  const foreignPrimaryConstraint = table.constraints.find(
    attr => attr.type === 'p',
  );
  if (!foreignPrimaryConstraint) return null;
  return foreignPrimaryConstraint.keyAttributes[0];
};
export const polyForeignKeyUnique = (
  build: GraphileBuild,
  foreignTable: PgClass,
  c: PgPolymorphicConstraint) => {
  const {
    pgIntrospectionResultsByKind: { constraint },
  } = build;
  const sourceTableId = `${c.name}_id`;
  const sourceTableType = `${c.name}_type`;
  const isForeignKeyUnique = constraint.find((c) => {
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
  return !!isForeignKeyUnique;
};

export const polymorphicCondition = (
  build: GraphileBuild,
  c: PgPolymorphicConstraint,
  polyQueryBuilder: QueryBuilder,
  targetQueryBuilder: QueryBuilder,
  targetModelName: string,
  pKey: PgAttribute) => {
  const { pgSql: sql } = build;
  const sourceTableId = `${c.name}_id`;
  const sourceTableType = `${c.name}_type`;
  const targetTableAlias = targetQueryBuilder.getTableAlias();
  const polyTableAlias = polyQueryBuilder.getTableAlias();
  return sql.query`(${sql.fragment`${targetTableAlias}.${sql.identifier(
    pKey.name,
  )} = ${sql.fragment`${polyTableAlias}.${sql.identifier(
    sourceTableId,
  )}`}`}) and (
    ${sql.fragment`${polyTableAlias}.${sql.identifier(
    sourceTableType,
  )} = ${sql.value(targetModelName)}`})`;
};

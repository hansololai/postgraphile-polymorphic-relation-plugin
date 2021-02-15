import { GraphileBuild, PgPolymorphicConstraint } from './postgraphile_types';
import { QueryBuilder, PgClass, PgAttribute } from 'graphile-build-pg';
import { IGraphQLToolsResolveInfo } from 'graphql-tools';
import { Build } from 'postgraphile';

export function canonical(str: string): string {
  const m = str.match(/\w+$/);
  return (m && m[0]) || str;
}

function notNull<T>(obj: T | null): obj is T {
  return !!obj;
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
export const columnToPolyConstraint = (build: GraphileBuild, attr: PgAttribute) => {
  const {
    name,
    tags: { polymorphicTo = [], isPolymorphic },
  } = attr;
  const { mapFieldToPgTable,
    pgIntrospectionResultsByKind: { classById },
  } = build;
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
    from: attr.class,
    to: targetTables.map((mName) => {
      const pgTableSimple = mapFieldToPgTable[mName];
      if (!pgTableSimple) return null;
      const c = classById[pgTableSimple.id];
      // Also this class need to have a single column primary key
      const keys = getPrimaryKeys(c);
      if (keys.length !== 1) {
        return null;
      }
      return {
        pgClass: c,
        pKey: keys[0],
        name: mName,
      };
    }).filter(notNull),
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
    inflection.connection(innerTableType.name),
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
        return data[safeAlias] || data[resolveInfo.fieldName];
      },
    };
  };
};

export const getPrimaryKeys = (
  table: PgClass) => {
  const foreignPrimaryConstraint = table.primaryKeyConstraint;
  if (!foreignPrimaryConstraint) return [];
  return foreignPrimaryConstraint.keyAttributes;
};
export const getPrimaryKey = (table: PgClass) => {
  const keys = getPrimaryKeys(table);
  return keys[0];
};
export const polyForeignKeyUnique = (
  build: GraphileBuild,
  foreignTable: PgClass,
  c: PgPolymorphicConstraint) => {
  const {
    pgIntrospectionResultsByKind: { constraint },
  } = build;
  const { sourceTableId, sourceTableType } = getSourceColumns(c);
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

export const polySqlKeyMatch = (
  build: Build,
  polyAlias: any,
  foreignAlias: any,
  fPKey: PgAttribute,
  modelName: string, polyConstraint: PgPolymorphicConstraint) => {
  const { pgSql: sql } = build;
  const { sourceTableId, sourceTableType } = getSourceColumns(polyConstraint);
  return sql.query`(${sql.fragment`${polyAlias}.${sql.identifier(
    sourceTableId,
  )} = ${foreignAlias}.${sql.identifier(fPKey.name)}`}) and (
${sql.fragment`${polyAlias}.${sql.identifier(sourceTableType)} = ${sql.value(
    modelName)}`})`;
};

export const polymorphicCondition = (
  build: Build,
  c: PgPolymorphicConstraint,
  polyQueryBuilder: QueryBuilder,
  targetQueryBuilder: QueryBuilder,
  targetModelName: string,
  pKey: PgAttribute) => {
  const targetTableAlias = targetQueryBuilder.getTableAlias();
  const polyTableAlias = polyQueryBuilder.getTableAlias();
  return polySqlKeyMatch(build, polyTableAlias, targetTableAlias, pKey, targetModelName, c);
};

export const ensureBuilderUniqueOrder = (
  build: Build,
  innerBuilder: QueryBuilder, table: PgClass) => {
  innerBuilder.beforeLock('orderBy', () => {
    // append order by primary key to the list of orders
    const { pgSql: sql } = build;
    if (!innerBuilder.isOrderUnique(false)) {
      (innerBuilder as any).data.cursorPrefix = ['primary_key_asc'];
      if (table.primaryKeyConstraint) {
        const fPrimaryKeys =
          table.primaryKeyConstraint.keyAttributes;
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
};

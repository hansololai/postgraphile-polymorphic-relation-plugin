import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild } from './postgraphile_types';
import { PgAttribute, PgProc } from 'graphile-build-pg';
interface SimplePgTableIntrospect {
  name: string;
  id: string;
  attributesMap: AttributesMap;
}
interface AttributesMap {
  [x: string]: PgAttribute | PgProc;
}
export type FieldToDBMap = {
  [x: string]: SimplePgTableIntrospect;
};

export const addModelTableMappingPlugin = (builder: SchemaBuilder, options: Options) => {
  const { pgSchemas = [] } = options as any;
  builder.hook('build', (build) => {
    const {
      pgIntrospectionResultsByKind: { procedure, class: pgClasses },
      inflection: { upperCamelCase, singularize, camelCase },
    } = build as GraphileBuild;

    const fieldToDBMap: FieldToDBMap = pgClasses.reduce((acc: FieldToDBMap, cur) => {
      // Only build the map for the included schema.
      // Also this mapping behave unexpectedly if there are tables with same name in different
      // Schema used in the postgraphile
      if (
        !pgSchemas.includes(cur.namespaceName) ||
        cur.namespaceName === 'pg_catalog' ||
        cur.namespaceName === 'information_schema'
      ) {
        // skipt it
        return acc;
      }
      const procedureAttriutesMap = procedure
        .filter(p => p.name.startsWith(`${cur.name}_`))
        .reduce((a: AttributesMap, c) => {
          // Should probably use inflection
          const k = singularize(camelCase(c.name.replace(`${cur.name}_`, '')));
          a[k] = c;
          return a;
        }, {});
      // The Model Name points to this pg object
      const curTable: SimplePgTableIntrospect = {
        name: cur.name,
        id: cur.id,
        attributesMap: cur.attributes.reduce((allAtt: AttributesMap, curA) => {
          allAtt[singularize(camelCase(curA.name))] = curA;
          return allAtt;
        }, procedureAttriutesMap),
      };
      acc[singularize(upperCamelCase(cur.name))] = curTable;
      return acc;
    }, {});
    return build.extend(build, { mapFieldToPgTable: fieldToDBMap });
  });
};

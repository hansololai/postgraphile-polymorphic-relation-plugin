import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild, FieldToDBMap, AttributesMap } from './postgraphile_types';

export const addModelTableMappingPlugin = (builder: SchemaBuilder, options: Options) => {
  const { pgSchemas = [] } = options as any;
  builder.hook('build', (build) => {
    const {
      inflection,
      pgIntrospectionResultsByKind: { procedure, class: pgClasses },
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
          const name = inflection.computedColumn(c.name.substr(cur.name.length + 1), c, cur);
          return { ...a, [name]: c };
        }, {});
      // The Model Name points to this pg object
      return {
        ...acc, [inflection.tableType(cur)]: {
          name: cur.name,
          id: cur.id,
          attributesMap: cur.attributes.reduce((allAtt: AttributesMap, curA) => {
            return { ...allAtt, [inflection.column(curA)]: curA };
          }, procedureAttriutesMap),
        },
      };
    }, {});
    return build.extend(build, { mapFieldToPgTable: fieldToDBMap });
  });
};

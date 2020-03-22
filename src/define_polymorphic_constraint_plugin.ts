import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild } from './postgraphile_types';
import { PgClass } from 'graphile-build-pg';
export interface PgPolymorphicConstraint {
  name: string;
  from: string; // classId
  backwardAssociationName?: string; // field name for backward association. (default table name)
  to: string[]; // due to limitation at the time, it is the ModelName array.
}
export type PgPolymorphicConstraints = PgPolymorphicConstraint[];

/**
 * @description This plugin add an array named 'pgPolymorphicClassAndTargetModels' in build,
 * If it already exist, it will append to it. It adds custom defined polymorphic constraints.
 * A polymorphic association via @smartComments on a xxx_type column should have 2 fields in tag
 * a isPolymorphic:true, (maybe can be deprecated), a polymorphicTo:[ModelNames].
 * @example create comment syntax
 * comment on column notes.noteable
 *  is E'@isPolymorphic\n@polymorphicTo Location\n@polymorphicTo Workflow'
 * @param builder The SchemaBuilder
 * @param options The option passed in. This Option is the same object allows access of custom
 * parameters they pass in when the call 'createPostGraphileSchema'
 * @author Han Lai
 */
export const definePolymorphicCustom = (builder: SchemaBuilder, options: Options) => {
  // First add an inflector for polymorphic backrelation type name
  builder.hook('inflection', inflection => ({
    ...inflection,
    forwardRelationByPolymorphic(table: PgClass, polymorphicName: string) {
      return this.camelCase(`${this.singularize(table.name)}-as-${polymorphicName}`);
    },
  }));
  builder.hook('build', (build) => {
    const {
      pgIntrospectionResultsByKind: { class: pgClasses, attributeByClassIdAndNum },
      pgPolymorphicClassAndTargetModels = [],
    } = build as GraphileBuild;

    const { pgSchemas = [] } = options as any;
    const pgPolymorphicClassAndTargetModelsCustome: PgPolymorphicConstraints = pgClasses
      // get all the class that are table, view, materialized view
      .filter(c => pgSchemas.includes(c.namespaceName) && ['r', 'v', 'm'].includes(c.classKind))
      .reduce((acc: PgPolymorphicConstraints, curClass) => {
        const curClassAttributes: { [x: string]: any } = attributeByClassIdAndNum[curClass.id];
        // We do it in two steps, first find all xxx_type
        const allCurrentClassAttributes = Object.values(curClassAttributes);
        const typeAttributes = allCurrentClassAttributes.filter((attribute) => {
          // Must be a xxx_type attribute, and also tags need to have "isPolymorphic"
          return attribute.name.endsWith('_type') && !!attribute.tags.isPolymorphic;
        });
        const polyConstraintsOfClass = typeAttributes.map((attribute) => {
          const {
            name,
            tags: { polymorphicTo = [], isPolymorphic },
          } = attribute;
          let targetTables: string[] = [];
          if (!Array.isArray(polymorphicTo)) {
            targetTables = [polymorphicTo];
          } else {
            targetTables = polymorphicTo;
          }
          targetTables = Array.from(new Set<string>(targetTables));
          const polymorphicKey = name.substring(0, name.length - 5);
          const newPolyConstraint: PgPolymorphicConstraint = {
            name: polymorphicKey,
            from: curClass.id,
            to: targetTables,
          };
          if (typeof isPolymorphic === 'string') {
            // There is a backward association name for this
            newPolyConstraint.backwardAssociationName = isPolymorphic;
          }
          return newPolyConstraint;
        });

        return [...acc, ...polyConstraintsOfClass];
      }, []);

    const pgPolymorphicClassAndTargetModelsCombined = [
      ...pgPolymorphicClassAndTargetModels, ...pgPolymorphicClassAndTargetModelsCustome,
    ];

    return build.extend(build, {
      pgPolymorphicClassAndTargetModels: pgPolymorphicClassAndTargetModelsCombined,
    });
  });
};

import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild, PgPolymorphicConstraint } from './postgraphile_types';
import { isPolymorphicColumn, columnToPolyConstraint } from './utils';
import { PgClass } from 'graphile-build-pg';

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
    filterManyPolyType(table: PgClass, foreignTable: PgClass) {
      return `${this.filterManyType(table, foreignTable)}Poly`;
    },
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
    backwardRelationByPolymorphicExist(
      table: PgClass,
      polyConstraint: PgPolymorphicConstraint,
      isUnique: boolean,
    ) {
      return `${this.backwardRelationByPolymorphic(table, polyConstraint, isUnique)}Exists`;
    },
  }));
  builder.hook('build', (build) => {
    const {
      pgIntrospectionResultsByKind: { attribute },
    } = build as GraphileBuild;

    const { pgSchemas = [] } = options as any;
    const pgPolymorphicClassAndTargetModels = attribute
      .filter((a) => {
        // the column must from a table of the same scheme
        return pgSchemas.includes(a.class.namespaceName)
          && isPolymorphicColumn(a);
      }).map(a => columnToPolyConstraint(build as GraphileBuild, a));

    return build.extend(build, {
      pgPolymorphicClassAndTargetModels,
    });
  });
};

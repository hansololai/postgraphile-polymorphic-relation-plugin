import { SchemaBuilder, Options } from 'postgraphile';
import { GraphileBuild } from './postgraphile_types';
import { isPolymorphicColumn, columnToPolyConstraint } from './utils';

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
      }).map(columnToPolyConstraint);

    return build.extend(build, {
      pgPolymorphicClassAndTargetModels,
    });
  });
};

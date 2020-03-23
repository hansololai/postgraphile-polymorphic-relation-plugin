import { addBackwardPolyRelationFilter } from './pgConnectionArgFilterBackwardPolyRelationPlugin';
import { addForwardPolyRelationFilter } from './pgConnectionArgFilterForwardPolyRelationPlugin';
import {
  SchemaBuilder, Options, makePluginByCombiningPlugins,
} from 'postgraphile';
const postGraphileConnectionFilterPolyCorePlugin = makePluginByCombiningPlugins(
  addForwardPolyRelationFilter,
  addBackwardPolyRelationFilter,
);

export const postGraphileConnectionFilterPolyPlugin = (
  builder: SchemaBuilder, options: Options,
) => {
  const {
    connectionFilterPolymorphicForward,
    connectionFilterPolymorphicBackward,
  } = options;
  // do not use the connectionFilter plugin if these two options are false.
  if (!connectionFilterPolymorphicForward && !connectionFilterPolymorphicBackward) {
    return;
  }
  builder.hook('build', (build) => {
    const pkg = require('../package.json');

    // Check dependencies
    if (!build.versions) {
      throw new Error(
        `Plugin ${pkg.name}@${
        pkg.version
        } requires graphile-build@^4.1.0 in order to check dependencies (current version: ${
        build.graphileBuildVersion
        })`,
      );
    }
    const depends = (name: string, range: string) => {
      if (!build.hasVersion(name, range)) {
        throw new Error(
          `Plugin ${pkg.name}@${pkg.version} requires ${name}@${range} (${
          build.versions[name]
            ? `current version: ${build.versions[name]}`
            : 'not found'
          })`,
        );
      }
    };
    depends('postgraphile-plugin-connection-filter', '^1.0.0');

    // Register this plugin
    build.versions = build.extend(build.versions, { [pkg.name]: pkg.version });

    return build;
  });

  postGraphileConnectionFilterPolyCorePlugin(builder, options);
};

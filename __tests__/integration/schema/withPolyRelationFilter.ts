import { postgraphilePolyRelationCorePlugin } from '../../../src';
import { withPgClient } from '../../helpers';
import { createPostGraphileSchema } from 'postgraphile';
import core from './core';

test('prints a schema with the filter plugin', async () => {
  core.test(["p"], {
    // skipPlugins: [PgConnectionArgCondition],
    // appendPlugins: [require("../../../index.js")],
    appendPlugins: [postgraphilePolyRelationCorePlugin],
    disableDefaultMutations: true,
    legacyRelations: "omit",
  });
});


import {
  postgraphilePolyRelationCorePlugin,
  addForwardPolyAssociation,
  addBackwardPolyAssociation,
} from '../../../src';
import { withPgClient } from '../../helpers';
import { createPostGraphileSchema } from 'postgraphile';
import core from './core';

test('prints a schema with the filter plugin', async () => {
  core.test(['p'], {
    // skipPlugins: [PgConnectionArgCondition],
    // appendPlugins: [require("../../../index.js")],
    appendPlugins: [postgraphilePolyRelationCorePlugin],
    disableDefaultMutations: true,
    legacyRelations: 'omit',
  });
});

test('using addForwardPolyAssociation directly will throw error', async () => {
  await expect(
    withPgClient(async (client) => {
      await createPostGraphileSchema(client, ['p'], {
        appendPlugins: [addForwardPolyAssociation],
        disableDefaultMutations: true,
      });
    }),
    // this should give error because the PgConnectionFilter plugin is not appended
  ).rejects.toThrowError();
});

test('using addBackwardPolyAssociation directly will throw error', async () => {
  await expect(
    withPgClient(async (client) => {
      await createPostGraphileSchema(client, ['p'], {
        appendPlugins: [addBackwardPolyAssociation],
        disableDefaultMutations: true,
      });
    }),
    // this should give error because the PgConnectionFilter plugin is not appended
  ).rejects.toThrowError();
});

import {
  postgraphilePolyRelationCorePlugin,
  addForwardPolyAssociation,
  addBackwardPolyAssociation,
} from '../../../src';
import { withPgClient } from '../../helpers';
import { createPostGraphileSchema } from 'postgraphile';
import core from './core';
import PgConnectionFilterPlugin from 'postgraphile-plugin-connection-filter';

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

test('prints a schema with the filter plugin will throw error', async () => {
  await expect(
    withPgClient(async (client) => {
      await createPostGraphileSchema(client, ['p'], {
        appendPlugins: [postgraphilePolyRelationCorePlugin],
        graphileBuildOptions: {
          connectionFilterPolymorphicForward: true,
        },
        disableDefaultMutations: true,
      });
    }),
    // this should give error because the PgConnectionFilter plugin is not appended
  ).rejects.toThrowError();
});
test('prints a schema with the filter plugin also with connection filter', async () => {
  await expect(
    withPgClient(async (client) => {
      await createPostGraphileSchema(client, ['p'], {
        appendPlugins: [
          PgConnectionFilterPlugin,
          postgraphilePolyRelationCorePlugin,
        ],
        graphileBuildOptions: {
          connectionFilterPolymorphicForward: true,
        },
        disableDefaultMutations: true,
      });
    }),
    // this should give error because the PgConnectionFilter plugin is not appended
  ).rejects.toThrowError();
});

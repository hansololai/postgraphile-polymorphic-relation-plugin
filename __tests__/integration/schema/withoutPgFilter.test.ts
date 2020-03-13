import { PostGraphileConnectionFilterPolyPlugin } from '../../../src/';
import { withPgClient } from '../../helpers';
import { createPostGraphileSchema } from 'postgraphile';
test('prints a schema with the filter plugin', async () => {
  await expect(
    withPgClient(async (client) => {
      await createPostGraphileSchema(client, ['p'], {
        appendPlugins: [PostGraphileConnectionFilterPolyPlugin],
        disableDefaultMutations: true,
      });
    }),
    // this should give error because the PgConnectionFilter plugin is not appended
  ).rejects.toThrowError();
});

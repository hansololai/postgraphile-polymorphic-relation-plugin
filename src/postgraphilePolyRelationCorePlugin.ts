import { addBackwardPolyAssociation } from './add_backward_poly_association_plugin';
import { addForwardPolyAssociation } from './add_forward_poly_association_plugin';
import { definePolymorphicCustom, addModelTableMappingPlugin } from 'postgraphile-plugin-connection-filter-polymorphic';
import { makePluginByCombiningPlugins } from 'postgraphile';
export const postgraphilePolyRelationCorePlugin = makePluginByCombiningPlugins(
  addModelTableMappingPlugin,
  definePolymorphicCustom,
  addBackwardPolyAssociation,
  addForwardPolyAssociation,
);

import { addBackwardPolyAssociation } from './add_backward_poly_association_plugin';
import { addForwardPolyAssociation } from './add_forward_poly_association_plugin';
import { definePolymorphicCustom } from './define_polymorphic_constraint_plugin';
import { addModelTableMappingPlugin } from './define_model_to_table_map_plugin';
import { makePluginByCombiningPlugins } from 'postgraphile';
import { postGraphileConnectionFilterPolyPlugin } from './postgraphileConnectionFilterPolyPlugin';
export const postgraphilePolyRelationCorePlugin = makePluginByCombiningPlugins(
  addModelTableMappingPlugin,
  definePolymorphicCustom,
  addBackwardPolyAssociation,
  addForwardPolyAssociation,
  postGraphileConnectionFilterPolyPlugin,
);

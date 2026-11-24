import type { PromptKind, PromptOwner } from "./prompt-library";

export const recipeStates = ["draft", "active", "archived", "superseded", "blocked"] as const;
export type RecipeState = typeof recipeStates[number];
export const recipeSourceKinds = ["history", "owner_asset", "manual", "catalog"] as const;
export type RecipeSourceKind = typeof recipeSourceKinds[number];
export const recipeContentStates = ["readable", "metadata_only", "not_recorded", "needs_contract", "forbidden", "unavailable", "stale", "integrity_failed"] as const;
export type RecipeContentState = typeof recipeContentStates[number];

export interface PromptRecipeFacets {
  schema_version: "yeisme.prompt_recipe_facets.v1";
  intent?: string;
  subject?: string[];
  style?: string[];
  scene?: string[];
  motion?: string[];
  camera?: string[];
  audio?: string[];
  model?: string;
  references?: string[];
  field_sources?: Record<string, "owner" | "user" | "derived">;
}

export interface PromptRecipeSource {
  source_kind: RecipeSourceKind;
  owner_prompt_ref?: string;
  owner_version?: number;
  source_digest?: string;
  task_ref?: string;
  request_ref?: string;
  batch_ref?: string;
  asset_refs?: string[];
}

export interface PromptRecipeSummary {
  schema_version: "yeisme.prompt_recipe.v1";
  recipe_ref: string;
  scope_id: string;
  visibility: "private" | "project";
  state: RecipeState;
  owner: PromptOwner;
  project_ref: string;
  title: string;
  kind: PromptKind;
  tags: string[];
  notes: string;
  source: PromptRecipeSource;
  facets: PromptRecipeFacets;
  revision: number;
  content_state: RecipeContentState;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PromptRecipeVersion {
  recipe_ref: string;
  revision: number;
  title: string;
  kind: PromptKind;
  tags: string[];
  notes: string;
  source: PromptRecipeSource;
  facets: PromptRecipeFacets;
  content_state: RecipeContentState;
  created_by: string;
  created_at: string;
}

export interface PromptRecipePage {
  schema_version: "yeisme.prompt_recipe.page.v1";
  rows: PromptRecipeSummary[];
  total: number;
  next_cursor: string | null;
  coverage: "complete" | "partial" | "unknown";
  epoch?: number;
}

export interface PromptRecipeUsePreview {
  schema_version: "yeisme.prompt_recipe.use_preview.v1";
  recipe_ref: string;
  recipe_revision: number;
  owner: PromptOwner;
  project_ref: string;
  owner_version: number | null;
  prompt_ref: string | null;
  source_digest: string | null;
  availability: "available" | "needs_contract" | "blocked";
  blockers: string[];
}

export interface PromptRecipeQuery {
  q?: string;
  owner?: PromptOwner;
  kind?: PromptKind;
  state?: RecipeState;
  source?: RecipeSourceKind;
  tag?: string;
  collection?: string;
  cursor?: string;
  limit?: number;
}

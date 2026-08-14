CREATE TABLE "generation_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text,
	"story_entry_id" text,
	"orig_story_id" text,
	"orig_variant_group_id" text,
	"story_title" text,
	"request_kind" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_name" text,
	"thinking" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cached_prompt_tokens" integer,
	"cost_usd" numeric(20, 12),
	"upstream_prompt_cost_usd" numeric(20, 12),
	"upstream_completion_cost_usd" numeric(20, 12),
	"is_byok" boolean,
	"openrouter_generation_id" text,
	"status" text NOT NULL,
	"cost_source" text,
	"created_at" text NOT NULL,
	"settled_at" text
);
--> statement-breakpoint
ALTER TABLE "generation_calls" ADD CONSTRAINT "generation_calls_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_calls" ADD CONSTRAINT "generation_calls_story_entry_id_story_entries_id_fk" FOREIGN KEY ("story_entry_id") REFERENCES "public"."story_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_calls_story_created_idx" ON "generation_calls" USING btree ("story_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_calls_created_idx" ON "generation_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generation_calls_entry_idx" ON "generation_calls" USING btree ("story_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_calls_openrouter_id_idx" ON "generation_calls" USING btree ("openrouter_generation_id") WHERE "openrouter_generation_id" is not null;
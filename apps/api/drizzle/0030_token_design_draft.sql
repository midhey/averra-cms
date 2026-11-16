-- Старые токены и вставки прежней версии после отката нового права не получают.
ALTER TABLE "api_tokens" ADD COLUMN "design_draft" boolean DEFAULT false NOT NULL;

import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module.js";
import { IsUniqueConstraint } from "./IsUniqueConstraint.js";

@Module({
  imports: [SupabaseModule],
  providers: [IsUniqueConstraint],
  exports: [IsUniqueConstraint],
})
export class ConstraintsModule {}

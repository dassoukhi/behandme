import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { IsUniqueConstraint } from "./IsUniqueConstraint";

@Module({
  imports: [SupabaseModule],
  providers: [IsUniqueConstraint],
  exports: [IsUniqueConstraint],
})
export class ConstraintsModule {}

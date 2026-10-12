import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from "class-validator";
import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";

@ValidatorConstraint({ async: true })
@Injectable()
export class IsUniqueConstraint implements ValidatorConstraintInterface {
  constructor(private readonly supabaseService: SupabaseService) {}

  async validate(value: any, args: ValidationArguments): Promise<boolean> {
    const [table, column] = args.constraints;

    const supabase = this.supabaseService.getClient(); // ⚠️ si undefined → module mal branché

    const { data, error } = await supabase
      .from(table)
      .select(column)
      .eq(column as string, value)
      .limit(1);

    if (error) {
      console.error("Supabase error:", error.message);
      return false;
    }

    return !data || data.length === 0;
  }

  defaultMessage(args: ValidationArguments) {
    const [table, column] = args.constraints;
    return `${args.property} must be unique in ${table}.${column}`;
  }
}

export function IsUnique(
  table: string,
  column: string,
  validationOptions?: ValidationOptions
) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [table, column],
      validator: IsUniqueConstraint,
    });
  };
}

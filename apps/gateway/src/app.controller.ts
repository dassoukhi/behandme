import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AppService } from "./app.service.js";
import { Public } from "./decorators/public.decorator.js";

@ApiTags("app")
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Get health status" })
  @ApiResponse({ status: 200, description: "Application is healthy" })
  getHealth(): { status: string; timestamp: string } {
    return this.appService.getHealth();
  }
}

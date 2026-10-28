import { PartialType } from "@nestjs/swagger";
import { CreateInspectorProfileDto } from "./create-inspector-profile.dto.js";

export class UpdateInspectorProfileDto extends PartialType(CreateInspectorProfileDto) { }
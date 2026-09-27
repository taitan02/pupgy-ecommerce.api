import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, getSchemaPath, type OpenAPIObject } from '@nestjs/swagger';
import { ProblemDto } from '../common/dto/problem.dto.js';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Ecommerce Marketplace API')
    .setDescription(
      'Contract between ecommerce-api and its consumers (storefront, admin). ' +
        'Additive changes only within v1 — see docs/api/versioning.md.',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:3000', 'Local development')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('storefront/categories', 'Public catalog taxonomy')
    .addTag('health', 'Liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config, { extraModels: [ProblemDto] });
  return withDefaultErrorResponse(document);
}

/**
 * Every endpoint can fail, and every failure leaves as problem+json. Declaring it
 * once here beats decorating hundreds of handlers, and without it generated clients
 * treat errors as impossible — `if (error)` then narrows to `never` and stops
 * compiling.
 */
function withDefaultErrorResponse(document: OpenAPIObject): OpenAPIObject {
  const errorResponse = {
    description: 'Request failed. RFC 9457 problem document with a stable `code`.',
    content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDto) } } },
  };

  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path)) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      operation.responses.default ??= errorResponse;
    }
  }

  return document;
}

export function setupSwaggerUi(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup('docs', app, document);
}

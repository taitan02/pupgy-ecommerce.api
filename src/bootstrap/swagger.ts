import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

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

  return SwaggerModule.createDocument(app, config);
}

export function setupSwaggerUi(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup('docs', app, document);
}

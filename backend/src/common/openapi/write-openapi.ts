import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRouteContracts } from '../../app.module.js';
import { generateOpenApiDocument } from './openapi-generator.js';
import { toYaml } from './openapi-yaml.js';

const outputDir = join(process.cwd(), 'openapi');
mkdirSync(outputDir, { recursive: true });
const document = generateOpenApiDocument(getRouteContracts());
writeFileSync(join(outputDir, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
writeFileSync(join(outputDir, 'openapi.yaml'), `${toYaml(document)}\n`, 'utf8');

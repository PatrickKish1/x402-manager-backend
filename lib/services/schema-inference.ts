/**
 * Schema Inference Utility
 * 
 * Generates JSON schemas from actual API responses and compares schemas
 * to determine the best/most complete schema for a service.
 */

/**
 * Infer a JSON schema from an actual response object
 */
export function inferSchemaFromResponse(data: any): any {
  if (data === null || data === undefined) {
    return { type: 'null' };
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { type: 'array', items: {} };
    }
    
    // Infer schema from first item, but mark as potentially incomplete
    const itemSchema = inferSchemaFromResponse(data[0]);
    return {
      type: 'array',
      items: itemSchema,
    };
  }

  if (typeof data === 'object') {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      properties[key] = inferSchemaFromResponse(value);
      
      // Consider non-null/non-undefined values as required
      if (value !== null && value !== undefined) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  // Primitive types
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
  };

  return { type: typeMap[typeof data] || 'string' };
}

/**
 * Count the total number of fields (including nested) in a schema
 */
function countSchemaFields(schema: any): number {
  if (!schema || typeof schema !== 'object') {
    return 0;
  }

  if (schema.type === 'array') {
    return countSchemaFields(schema.items || {});
  }

  if (schema.type === 'object' && schema.properties) {
    let count = Object.keys(schema.properties).length;
    for (const prop of Object.values(schema.properties)) {
      count += countSchemaFields(prop);
    }
    return count;
  }

  return 0;
}

/**
 * Calculate schema depth (max nesting level)
 */
function calculateSchemaDepth(schema: any, currentDepth = 0): number {
  if (!schema || typeof schema !== 'object') {
    return currentDepth;
  }

  if (schema.type === 'array') {
    return calculateSchemaDepth(schema.items || {}, currentDepth + 1);
  }

  if (schema.type === 'object' && schema.properties) {
    let maxDepth = currentDepth;
    for (const prop of Object.values(schema.properties)) {
      const depth = calculateSchemaDepth(prop, currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }
    return maxDepth;
  }

  return currentDepth;
}

/**
 * Compare two schemas and determine which is "better" (more complete)
 * Returns: 'new', 'existing', or 'same'
 */
export function compareSchemas(existingSchema: any, newSchema: any): 'new' | 'existing' | 'same' {
  if (!existingSchema) {
    return 'new';
  }

  if (!newSchema) {
    return 'existing';
  }

  try {
    const existingFields = countSchemaFields(existingSchema);
    const newFields = countSchemaFields(newSchema);
    const existingDepth = calculateSchemaDepth(existingSchema);
    const newDepth = calculateSchemaDepth(newSchema);

    // Prefer schema with more fields
    if (newFields > existingFields) {
      return 'new';
    }

    if (existingFields > newFields) {
      return 'existing';
    }

    // If same field count, prefer deeper schema (more nested structure)
    if (newDepth > existingDepth) {
      return 'new';
    }

    if (existingDepth > newDepth) {
      return 'existing';
    }

    // If same fields and depth, keep existing (no change needed)
    return 'same';
  } catch (error) {
    console.error('[Schema Comparison] Error comparing schemas:', error);
    // On error, prefer existing to avoid overwriting with invalid data
    return 'existing';
  }
}

/**
 * Get the best schema between existing and new
 */
export function getBestSchema(existingSchema: any, newSchema: any): any {
  const comparison = compareSchemas(existingSchema, newSchema);
  
  if (comparison === 'new') {
    return newSchema;
  }
  
  return existingSchema || newSchema;
}


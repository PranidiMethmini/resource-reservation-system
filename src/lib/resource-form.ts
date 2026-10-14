export type ResourceValues = { name: string; type: string; location: string; capacity: string; description: string; isActive: boolean };
export type ResourceField = "name" | "type" | "location" | "capacity" | "description";
export function validateResource(values: ResourceValues): Partial<Record<ResourceField, string>> {
  const errors: Partial<Record<ResourceField, string>> = {};
  if (!values.name.trim()) errors.name = "Enter a resource name.";
  if (!values.type.trim()) errors.type = "Enter a resource type.";
  if (!values.location.trim()) errors.location = "Enter a location.";
  if (values.name.trim().length > 100) errors.name = "Resource name must be 100 characters or fewer.";
  if (values.type.trim().length > 100) errors.type = "Resource type must be 100 characters or fewer.";
  if (values.location.trim().length > 200) errors.location = "Location must be 200 characters or fewer.";
  if (values.description.trim().length > 2000) errors.description = "Description must be 2,000 characters or fewer.";
  const capacity = Number(values.capacity);
  if (!values.capacity.trim() || !Number.isInteger(capacity) || capacity <= 0) errors.capacity = "Enter a positive whole-number capacity.";
  else if (capacity > 2147483647) errors.capacity = "Capacity exceeds the supported database integer range.";
  return errors;
}
export function resourcePayload(values: ResourceValues) {
  return { name: values.name.trim(), type: values.type.trim(), location: values.location.trim(), capacity: Number(values.capacity), description: values.description.trim(), isActive: values.isActive };
}

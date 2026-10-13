export type CatalogResource = {
  id: string;
  name: string;
  type: string;
  location: string;
  capacity: number;
  description: string | null;
  isActive: boolean;
};

export type ResourceFilters = {
  search: string;
  type: string;
  status: "all" | "active" | "inactive";
};

export function filterResources(resources: CatalogResource[], filters: ResourceFilters): CatalogResource[] {
  const search = filters.search.trim().toLowerCase();
  return resources.filter((resource) => {
    const matchesSearch = !search || [resource.name, resource.type, resource.location].some((value) => value.toLowerCase().includes(search));
    const matchesType = !filters.type || resource.type === filters.type;
    const matchesStatus = filters.status === "all" || resource.isActive === (filters.status === "active");
    return matchesSearch && matchesType && matchesStatus;
  });
}

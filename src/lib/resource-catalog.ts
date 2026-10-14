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
  const search = typeof filters.search === "string" ? filters.search.trim().toLowerCase() : "";
  const type = typeof filters.type === "string" ? filters.type : "";
  const status = ["all", "active", "inactive"].includes(filters.status) ? filters.status : "all";
  return resources.filter((resource) => {
    const matchesSearch = !search || [resource.name, resource.type, resource.location].some((value) => typeof value === "string" && value.toLowerCase().includes(search));
    const matchesType = !type || resource.type === type;
    const matchesStatus = status === "all" || resource.isActive === (status === "active");
    return matchesSearch && matchesType && matchesStatus;
  });
}

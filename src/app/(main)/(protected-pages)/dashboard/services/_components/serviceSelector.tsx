"use client";

import { useState, useTransition, useOptimistic } from "react";
import { SERVICES, type ServiceItem } from "@/config/services";
import { addServiceAction, removeServiceAction } from "../actions";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CheckIcon, Loader2Icon, XIcon, PackageOpenIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServiceSelectorProps {
    initialSelected: string[];
}

export function ServiceSelector({ initialSelected }: ServiceSelectorProps) {
    const [search, setSearch] = useState("");
    const [isPending, startTransition] = useTransition();
    const [optimisticSelected, updateOptimistic] = useOptimistic(
        initialSelected,
        (state, { type, slug }: { type: "add" | "remove"; slug: string }) =>
            type === "add" ? [...state, slug] : state.filter((s) => s !== slug)
    );

    // Get full service objects for currently selected slugs
    const selectedServices = SERVICES.filter((s) =>
        optimisticSelected.includes(s.id)
    );

    // Filtered tiles based on search
    const filteredServices = SERVICES.filter(
        (s) =>
            s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.description.toLowerCase().includes(search.toLowerCase())
    );

    // Separate filtered services into selected and unselected
    const filteredSelected = filteredServices.filter((s) =>
        optimisticSelected.includes(s.id)
    );
    const filteredUnselected = filteredServices.filter(
        (s) => !optimisticSelected.includes(s.id)
    );

    async function handleToggle(slug: string) {
        const currentlySelected = optimisticSelected.includes(slug);
        startTransition(async () => {
            updateOptimistic({ type: currentlySelected ? "remove" : "add", slug });
            try {
                if (currentlySelected) {
                    await removeServiceAction(slug);
                } else {
                    await addServiceAction(slug);
                }
            } catch (error) {
                updateOptimistic({
                    type: currentlySelected ? "add" : "remove",
                    slug,
                });
                toast.error("Failed to update services. Please try again.");
            }
        });
    }

    return (
        <div className="flex flex-col gap-6 p-4 md:p-8">
            {/* Selected services chips */}
            <div>
                <label className="block text-sm font-medium mb-2">
                    Your selected services
                </label>
                <div className="flex flex-wrap gap-2">
                    {selectedServices.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                            No services selected yet
                        </p>
                    ) : (
                        selectedServices.map((service) => (
                            <div
                                key={service.id}
                                className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                            >
                                {service.name}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggle(service.id);
                                    }}
                                    className="cursor-pointer ml-1 rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                                    aria-label={`Remove ${service.name}`}
                                >
                                    <XIcon className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Search */}
            <Input
                type="search"
                placeholder="Search services..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-md"
            />

            {/* Tiles grid: Selected first, then divider, then unselected */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {/* Selected services */}
                {filteredSelected.map((service) => (
                    <ServiceTile
                        key={service.id}
                        service={service}
                        isSelected={true}
                        isPending={isPending}
                        onToggle={() => handleToggle(service.id)}
                    />
                ))}

                {/* Divider between selected and unselected */}
                {filteredSelected.length > 0 && filteredUnselected.length > 0 && (
                    <div className="col-span-full flex items-center gap-4 my-4">
                        <div className="h-px flex-1 bg-border" />
                        <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                            <PackageOpenIcon className="h-4 w-4" />
                            Other Services
                        </div>
                        <div className="h-px flex-1 bg-border" />
                    </div>
                )}

                {/* Unselected services */}
                {filteredUnselected.map((service) => (
                    <ServiceTile
                        key={service.id}
                        service={service}
                        isSelected={false}
                        isPending={isPending}
                        onToggle={() => handleToggle(service.id)}
                    />
                ))}

                {/* Empty state if search yields nothing */}
                {filteredServices.length === 0 && (
                    <p className="col-span-full text-muted-foreground text-center py-8">
                        No services match your search.
                    </p>
                )}
            </div>
        </div>
    );
}

function ServiceTile({
    service,
    isSelected,
    isPending,
    onToggle,
}: {
    service: ServiceItem;
    isSelected: boolean;
    isPending: boolean;
    onToggle: () => void;
}) {
    return (
        <Card
            className={cn(
                "cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 relative",
                isSelected && "ring-2 ring-primary bg-primary/5"
            )}
            onClick={onToggle}
        >
            <CardContent className="p-4 flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                    {isPending ? (
                        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : isSelected ? (
                        <CheckIcon className="h-5 w-5 text-primary" />
                    ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                    )}
                </div>
                <div className="flex-1">
                    <h3 className="font-semibold text-sm">{service.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {service.description}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
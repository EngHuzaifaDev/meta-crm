"use client";

import { startTransition, useActionState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createLeadAction } from "../actions";
import { INDUSTRIES } from "@/config/industries";
import { IndustryCombobox } from "./industryComboBox";

// ---------- Validation Schema ----------
// Updated form schema with max lengths
const formSchema = z.object({
    name: z
        .string()
        .min(1, "Name is required.")
        .max(100, "Name must be under 100 characters."),
    website: z
        .url("Please enter a valid URL.")
        .optional()
        .or(z.literal("")),
    industry: z.string().max(50).optional(),
    numberOfEmployees: z.string().optional(),
    description: z
        .string()
        .max(1000, "Description must be under 1000 characters.")
        .optional(),
});

type FormValues = z.infer<typeof formSchema>;

// ---------- Employee range options ----------
const EMPLOYEE_RANGES = [
    { label: "1 – 10", value: "1" },
    { label: "11 – 50", value: "11" },
    { label: "51 – 200", value: "51" },
    { label: "201 – 500", value: "201" },
    { label: "501 – 1,000", value: "501" },
    { label: "1,001 – 5,000", value: "1001" },
    { label: "5,001 – 10,000", value: "5001" },
    { label: "10,001+", value: "10001" },
] as const;

export function NewLeadForm() {
    const router = useRouter();

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            website: "",
            industry: "",
            numberOfEmployees: "",
            description: "",
        },
    });

    // React 19: useActionState with our server action
    const [serverState, formAction, isPending] = useActionState(
        async (prevState: { error?: string; success?: boolean; leadId?: string }, formData: FormData) => {
            return await createLeadAction(prevState, formData);
        },
        { error: "" }
    );

    // Handle success / error toasts
    useEffect(() => {
        if (serverState.success && serverState.leadId) {
            toast.success("Lead created successfully!");
            router.push(`/dashboard/leads/${serverState.leadId}`);
        } else if (serverState.error) {
            toast.error(serverState.error);
        }
    }, [serverState, router]);

    const onSubmit = form.handleSubmit((data) => {
        const formData = new FormData();
        formData.append("name", data.name);
        if (data.website) formData.append("website", data.website);
        if (data.industry) formData.append("industry", data.industry);
        if (data.numberOfEmployees)
            formData.append("numberOfEmployees", data.numberOfEmployees);
        if (data.description) formData.append("description", data.description);

        startTransition(() => {
            formAction(formData);
        });
    });

    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 max-w-2xl">
            <FieldGroup className="gap-4">
                {/* Name */}
                <Controller
                    control={form.control}
                    name="name"
                    render={({ field, fieldState }) => (
                        <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="lead-name">Name *</FieldLabel>
                            <Input
                                {...field}
                                id="lead-name"
                                placeholder="Company or lead name"
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />

                {/* Website */}
                <Controller
                    control={form.control}
                    name="website"
                    render={({ field, fieldState }) => (
                        <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="lead-website">Website</FieldLabel>
                            <Input
                                {...field}
                                id="lead-website"
                                type="url"
                                placeholder="https://example.com"
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />

                {/* Industry – searchable combobox */}
                <Controller
                    control={form.control}
                    name="industry"
                    render={({ field, fieldState }) => (
                        <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="lead-industry">Industry</FieldLabel>
                            <IndustryCombobox
                                options={INDUSTRIES}
                                value={field.value}
                                onChange={field.onChange}
                            />
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />

                {/* Number of Employees – native select */}
                <Controller
                    control={form.control}
                    name="numberOfEmployees"
                    render={({ field, fieldState }) => (
                        <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="lead-employees">Number of Employees</FieldLabel>
                            <select
                                {...field}
                                id="lead-employees"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <option value="" disabled>
                                    Select a range
                                </option>
                                {EMPLOYEE_RANGES.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.label}
                                    </option>
                                ))}
                            </select>
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />

                {/* Description */}
                <Controller
                    control={form.control}
                    name="description"
                    render={({ field, fieldState }) => (
                        <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="lead-description">Description</FieldLabel>
                            <Textarea
                                {...field}
                                id="lead-description"
                                placeholder="Brief description..."
                                rows={4}
                                maxLength={1000}               // 👈 native browser limit
                                aria-invalid={fieldState.invalid}
                            />
                            <div className="flex justify-end">
                                <span className="text-xs text-muted-foreground">
                                    {field.value?.length ?? 0}/1000
                                </span>
                            </div>
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />
            </FieldGroup>

            <Button className="w-full sm:w-auto" type="submit" disabled={isPending}>
                {isPending ? "Creating Lead…" : "Create Lead"}
            </Button>
        </form>
    );
}
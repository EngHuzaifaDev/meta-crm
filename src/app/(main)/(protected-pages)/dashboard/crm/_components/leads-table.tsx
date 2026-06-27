"use client";
"use no memo";

import * as React from "react";
import {
    type ColumnFiltersState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type PaginationState,
    useReactTable,
    type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDownIcon, ListFilter } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fetchLeadsForDashboard } from "../actions";
import { LEAD_STAGES } from "@/lib/db/types";
import type { ColumnDef } from "@tanstack/react-table";

// ----- Row shape -----
interface LeadRow {
    id: string;
    name: string;
    website: string;
    industry: string;
    employees?: number;
    stage: string;
}

// ----- Columns -----
const columns: ColumnDef<LeadRow>[] = [
    {
        accessorKey: "id",
        header: "ID",
        cell: ({ row }) => <div className="text-sm tracking-tight">{row.original.id}</div>,
        enableHiding: false,
    },
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <div className="font-medium text-sm">{row.original.name}</div>,
    },
    {
        accessorKey: "website",
        header: "Website",
        cell: ({ row }) => {
            const website = row.original.website;
            if (!website) return null;
            return (
                <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline text-sm"
                >
                    {website.replace(/^https?:\/\//, "")}
                </a>
            );
        },
    },
    {
        accessorKey: "industry",
        header: "Industry",
        cell: ({ row }) => <div className="text-sm">{row.original.industry || "—"}</div>,
    },
    {
        accessorKey: "stage",
        header: "Stage",
        cell: ({ row }) => (
            <Badge variant="outline" className="rounded-full px-2.5">
                {row.original.stage}
            </Badge>
        ),
        filterFn: "equalsString",
    },
];

// ----- Component -----
export function LeadsTable() {
    const [data, setData] = React.useState<LeadRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = React.useState("");
    const [pagination, setPagination] = React.useState<PaginationState>({
        pageIndex: 0,
        pageSize: 10,
    });

    React.useEffect(() => {
        fetchLeadsForDashboard()
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const table = useReactTable({
        data,
        columns,
        state: {
            columnFilters,
            globalFilter,
            pagination,
        },
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        globalFilterFn: "includesString",
    });

    const searchQuery = table.getState().globalFilter ?? "";
    const stageFilter = (table.getColumn("stage")?.getFilterValue() as string) ?? "all";
    const currentPage = table.getState().pagination.pageIndex + 1;
    const pageCount = table.getPageCount();
    const filteredCount = table.getFilteredRowModel().rows.length;
    const visibleCount = table.getRowModel().rows.length;

    const pageNumbers = React.useMemo(() => {
        if (pageCount <= 3) return Array.from({ length: pageCount }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= pageCount - 1) return [pageCount - 2, pageCount - 1, pageCount];
        return [currentPage - 1, currentPage, currentPage + 1];
    }, [currentPage, pageCount]);

    return (
        <section>
            <Card>
                <CardHeader>
                    <CardTitle className="leading-none">Leads Pipeline</CardTitle>
                    <CardDescription>
                        All your leads and their current stages.
                    </CardDescription>
                    <CardAction>
                        <div className="flex items-center gap-2">
                            <Input
                                className="h-7 w-44 md:w-52"
                                placeholder="Search leads..."
                                value={searchQuery}
                                onChange={(e) => {
                                    table.setGlobalFilter(e.target.value || undefined);
                                    table.setPageIndex(0);
                                }}
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <ListFilter data-icon="inline-start" />
                                        Stage
                                        <ChevronDownIcon data-icon="inline-end" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuRadioGroup
                                        value={stageFilter}
                                        onValueChange={(value) => {
                                            table.getColumn("stage")?.setFilterValue(value === "all" ? undefined : value);
                                            table.setPageIndex(0);
                                        }}
                                    >
                                        <DropdownMenuRadioItem value="all">All stages</DropdownMenuRadioItem>
                                        {LEAD_STAGES.map((stage) => (
                                            <DropdownMenuRadioItem key={stage} value={stage}>
                                                {stage}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 px-0">
                    {loading ? (
                        <div className="flex justify-center py-8 text-muted-foreground">Loading leads…</div>
                    ) : (
                        <>
                            <div className="overflow-hidden">
                                <Table className="**:data-[slot='table-cell']:px-4 **:data-[slot='table-head']:px-4 **:data-[slot='table-cell']:py-4">
                                    <TableHeader className="border-t **:data-[slot='table-head']:h-11 **:data-[slot='table-head']:font-medium **:data-[slot='table-head']:text-foreground **:data-[slot='table-head']:text-sm">
                                        {table.getHeaderGroups().map((headerGroup) => (
                                            <TableRow key={headerGroup.id}>
                                                {headerGroup.headers.map((header) => (
                                                    <TableHead key={header.id} colSpan={header.colSpan}>
                                                        {header.isPlaceholder
                                                            ? null
                                                            : flexRender(header.column.columnDef.header, header.getContext())}
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableHeader>
                                    <TableBody className="**:data-[slot='table-row']:border-border/50 **:data-[slot='table-row']:hover:bg-transparent">
                                        {table.getRowModel().rows.length ? (
                                            table.getRowModel().rows.map((row) => (
                                                <TableRow key={row.id}>
                                                    {row.getVisibleCells().map((cell) => (
                                                        <TableCell key={cell.id}>
                                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                                    No leads found.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="flex items-center justify-between gap-4 px-4 pb-1">
                                <p className="text-muted-foreground text-sm">
                                    Viewing {visibleCount} out of {filteredCount.toLocaleString()} leads
                                </p>
                                <Pagination className="mx-0 w-auto justify-end">
                                    <PaginationContent className="gap-1.5">
                                        <PaginationItem>
                                            <PaginationPrevious
                                                href="#"
                                                className={!table.getCanPreviousPage() ? "pointer-events-none opacity-50" : undefined}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    table.previousPage();
                                                }}
                                            />
                                        </PaginationItem>
                                        {pageNumbers[0] > 1 && (
                                            <PaginationItem>
                                                <PaginationEllipsis />
                                            </PaginationItem>
                                        )}
                                        {pageNumbers.map((pageNumber) => (
                                            <PaginationItem key={`page-${pageNumber}`}>
                                                <PaginationLink
                                                    href="#"
                                                    isActive={table.getState().pagination.pageIndex === pageNumber - 1}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        table.setPageIndex(pageNumber - 1);
                                                    }}
                                                >
                                                    {pageNumber}
                                                </PaginationLink>
                                            </PaginationItem>
                                        ))}
                                        {pageNumbers[pageNumbers.length - 1] < pageCount && (
                                            <PaginationItem>
                                                <PaginationEllipsis />
                                            </PaginationItem>
                                        )}
                                        <PaginationItem>
                                            <PaginationNext
                                                href="#"
                                                className={!table.getCanNextPage() ? "pointer-events-none opacity-50" : undefined}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    table.nextPage();
                                                }}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </section>
    );
}
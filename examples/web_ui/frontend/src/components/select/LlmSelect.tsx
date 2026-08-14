import { ChevronDown, PlusCircle, Ban } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ChatModelConfig, ModelCard } from '@/api';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useAvailableModels } from '@/hooks/useAvailableModels';
import { useTranslation } from '@/i18n/useI18n.ts';
import { cn } from '@/lib/utils';

interface Props extends Omit<React.ComponentPropsWithoutRef<typeof Button>, 'onChange' | 'value'> {
	value?: ChatModelConfig | null;
	/**
	 * Called when the user selects a model, or — when `allowClear` is true —
	 * clears the selection (in which case `null` is emitted).
	 */
	onChange?: (value: ChatModelConfig | null) => void;
	onAddCredential?: () => void;
	refetchTrigger?: number;
	/** Override the trigger label shown when no model is selected. */
	placeholder?: string;
	/**
	 * When true, append a "clear selection" item to the dropdown that emits
	 * `null` via `onChange`. Used by the fallback selector.
	 */
	allowClear?: boolean;
	/** Override the label of the "clear selection" item. */
	clearLabel?: string;
}

export function LlmSelect({
	value,
	onChange,
	onAddCredential,
	refetchTrigger,
	placeholder,
	allowClear = false,
	clearLabel,
	className,
	...props
}: Props) {
	const { groups, loading, refetch } = useAvailableModels();
	const { t } = useTranslation();
	const [query, setQuery] = useState('');
	const [customName, setCustomName] = useState('');
	const hasOptions = Object.keys(groups).length > 0;

	useEffect(() => {
		if (refetchTrigger !== undefined && refetchTrigger > 0) void refetch(true);
	}, [refetchTrigger, refetch]);

	const handleSelect = (type: string, credentialId: string, model: string) => {
		onChange?.({ type, credential_id: credentialId, model, parameters: {} });
	};

	const filterModels = (models: ModelCard[]) => {
		const q = query.trim().toLowerCase();
		if (!q) return models;
		return models.filter(
			(m) => m.name.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
		);
	};

	const applyCustom = (type: string, credentialId: string) => {
		const name = customName.trim();
		if (!name) return;
		handleSelect(type, credentialId, name);
		setCustomName('');
	};

	const renderCustomField = (type: string, credentialId: string) => (
		<div
			className="flex flex-col gap-1 px-2 py-1.5"
			onPointerDown={(e) => e.stopPropagation()}
		>
			<Input
				value={customName}
				onChange={(e) => setCustomName(e.target.value)}
				placeholder={t('llm-select.customPlaceholder')}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') {
						e.preventDefault();
						applyCustom(type, credentialId);
					}
				}}
			/>
			<Button
				size="sm"
				variant="secondary"
				disabled={!customName.trim()}
				onClick={() => applyCustom(type, credentialId)}
			>
				{t('llm-select.customApply')}
			</Button>
		</div>
	);

	const displayLabel = value?.model
		? value.model
		: loading
			? t('llm-select.loading')
			: (placeholder ?? t('llm-select.placeholder'));

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn('justify-between gap-1 font-normal', className)}
					{...props}
				>
					<span className="truncate">{displayLabel}</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-64 max-h-80 overflow-y-auto">
				{hasOptions && (
					<div
						className="px-2 py-1.5"
						onPointerDown={(e) => e.stopPropagation()}
					>
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={t('llm-select.searchPlaceholder')}
							onKeyDown={(e) => e.stopPropagation()}
						/>
					</div>
				)}
				{!loading && !hasOptions ? (
					<div className="px-2 py-3 text-center text-sm text-muted-foreground">
						<p className="font-medium">{t('llm-select.empty.title')}</p>
						<p className="text-xs mt-1">{t('llm-select.empty.description')}</p>
					</div>
				) : (
					Object.entries(groups).map(([type, items], idx) => {
						const isSingle = items.length === 1;
						return (
							<DropdownMenuGroup key={type}>
								{idx > 0 && <DropdownMenuSeparator />}
								<DropdownMenuLabel>
									{type.replace(/_credential$/, '')}
								</DropdownMenuLabel>
								{isSingle
									? filterModels(items[0].models).map((m) => (
											<DropdownMenuItem
												key={m.name}
												onSelect={() =>
													handleSelect(
														type,
														items[0].credential.id,
														m.name,
													)
												}
											>
												{m.name}
											</DropdownMenuItem>
										))
									: items.map(({ credential, models }) => {
											const credName =
												(credential.data.name as string) ||
												credential.id.slice(0, 8);
											return (
												<DropdownMenuSub key={credential.id}>
													<DropdownMenuSubTrigger>
														{credName}
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="max-h-60 overflow-y-auto">
														{filterModels(models).map((m) => (
															<DropdownMenuItem
																key={m.name}
																onSelect={() =>
																	handleSelect(
																		type,
																		credential.id,
																		m.name,
																	)
																}
															>
																{m.label}
															</DropdownMenuItem>
														))}
														<DropdownMenuSeparator />
														{renderCustomField(type, credential.id)}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
											);
										})}
								{isSingle && (
									<>
										<DropdownMenuSeparator />
										{renderCustomField(type, items[0].credential.id)}
									</>
								)}
							</DropdownMenuGroup>
						);
					})
				)}
				<DropdownMenuSeparator />
				{allowClear && (
					<DropdownMenuItem onSelect={() => onChange?.(null)} disabled={!value}>
						<Ban className="size-4" />
						<span>{clearLabel ?? t('llm-select.clear')}</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={onAddCredential}>
					<PlusCircle className="size-4" />
					<span>{t('llm-select.addCredential')}</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

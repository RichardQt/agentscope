# -*- coding: utf-8 -*-
"""The model router."""

from fastapi import APIRouter, Depends, Header, HTTPException, status

from ._schema import ListModelsResponse, ListModelsRequest
from .._service import ResourceAccessService
from .._service._live_catalog import (
    chat_cards_from_ids,
    probe_openai_compatible_ids,
)
from ..deps import get_resource_access_service
from ...credential import CredentialFactory

model_router = APIRouter(
    prefix="/model",
    tags=["model"],
    responses={404: {"description": "Not found"}},
)


@model_router.get(
    "/",
    response_model=ListModelsResponse,
    summary="List all candidate models under the given credential type",
)
async def list_models(
    body: ListModelsRequest = Depends(),
    x_user_id: str | None = Header(default=None, alias="X-User-ID"),
    access: ResourceAccessService = Depends(get_resource_access_service),
) -> ListModelsResponse:
    """Return candidate models for a provider, optionally from a live endpoint.

    Built-in YAML catalogs are used when ``credential_id`` is omitted, or
    when probing the credential's ``/models`` endpoint fails. Passing a
    credential id (OpenAI-compatible hosts such as SiliconFlow) replaces
    the official OpenAI names with whatever that host actually serves.

    Args:
        body (ListModelsRequest): The query parameters.
        x_user_id (`str | None`):
            Caller id. Required when ``credential_id`` is set.
        access (`ResourceAccessService`):
            Resolves the credential for a live probe.

    Returns:
        `ListModelsResponse`: The response body.
    """
    credential_cls = CredentialFactory.get_credential_class(body.provider)
    if credential_cls is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{body.provider}' not found.",
        )

    model_cls = credential_cls.get_chat_model_class()
    catalog = model_cls.list_models()

    if body.credential_id:
        if not x_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="X-User-ID header is required.",
            )
        record = await access.resolve_credential(x_user_id, body.credential_id)
        credential = CredentialFactory.from_dict(record.data)
        live = chat_cards_from_ids(
            await probe_openai_compatible_ids(
                credential,
                cache_key=body.credential_id,
            ),
            model_cls.Parameters,
        )
        if live:
            catalog = live

    return ListModelsResponse(models=catalog, total=len(catalog))

# -*- coding: utf-8 -*-
"""The embedding model router."""

from fastapi import APIRouter, Depends, Header, HTTPException, status

from ._schema import ListEmbeddingModelsResponse, ListEmbeddingModelsRequest
from .._service import ResourceAccessService
from .._service._live_catalog import (
    embedding_cards_from_ids,
    probe_openai_compatible_ids,
)
from ..deps import get_resource_access_service
from ...credential import CredentialFactory

embedding_model_router = APIRouter(
    prefix="/embedding-model",
    tags=["embedding-model"],
    responses={404: {"description": "Not found"}},
)


@embedding_model_router.get(
    "/",
    response_model=ListEmbeddingModelsResponse,
    summary=(
        "List all candidate embedding models under the given credential type"
    ),
)
async def list_embedding_models(
    body: ListEmbeddingModelsRequest = Depends(),
    x_user_id: str | None = Header(default=None, alias="X-User-ID"),
    access: ResourceAccessService = Depends(get_resource_access_service),
) -> ListEmbeddingModelsResponse:
    """Return candidate embedding models, optionally from a live endpoint.

    Unlike ``/knowledge_bases/embedding_models``, which narrows the
    list to what the knowledge base's dimension policy accepts, this
    endpoint reports the provider's full catalogue — it answers "what
    can this credential do", not "what can I build a KB with".

    Built-in YAML catalogs are used when ``credential_id`` is omitted,
    or when probing the credential's ``/models`` endpoint fails.

    Args:
        body (ListEmbeddingModelsRequest): The query parameters.
        x_user_id (`str | None`):
            Caller id. Required when ``credential_id`` is set.
        access (`ResourceAccessService`):
            Resolves the credential for a live probe.

    Returns:
        `ListEmbeddingModelsResponse`: The response body.
    """
    credential_cls = CredentialFactory.get_credential_class(body.provider)
    if credential_cls is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{body.provider}' not found.",
        )

    embedding_cls = credential_cls.get_embedding_model_class()
    # Providers without embedding support report an empty catalogue
    # rather than 404 — "none available" is a valid answer here.
    catalog = [] if embedding_cls is None else embedding_cls.list_models()

    if body.credential_id and embedding_cls is not None:
        if not x_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="X-User-ID header is required.",
            )
        record = await access.resolve_credential(x_user_id, body.credential_id)
        credential = CredentialFactory.from_dict(record.data)
        live = embedding_cards_from_ids(
            await probe_openai_compatible_ids(
                credential,
                cache_key=body.credential_id,
            ),
            embedding_cls.Parameters,
        )
        if live:
            catalog = live

    return ListEmbeddingModelsResponse(models=catalog, total=len(catalog))

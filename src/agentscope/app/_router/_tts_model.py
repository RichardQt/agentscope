# -*- coding: utf-8 -*-
"""The TTS model router."""

from fastapi import APIRouter, Depends, Header, HTTPException, status

from ._schema import ListTTSModelsResponse, ListTTSModelsRequest
from .._service import ResourceAccessService
from .._service._live_catalog import (
    probe_openai_compatible_ids,
    tts_cards_from_ids,
)
from ..deps import get_resource_access_service
from ...credential import CredentialFactory

tts_model_router = APIRouter(
    prefix="/tts-model",
    tags=["tts-model"],
    responses={404: {"description": "Not found"}},
)


@tts_model_router.get(
    "/",
    response_model=ListTTSModelsResponse,
    summary="List all candidate TTS models under the given credential type",
)
async def list_tts_models(
    body: ListTTSModelsRequest = Depends(),
    x_user_id: str | None = Header(default=None, alias="X-User-ID"),
    access: ResourceAccessService = Depends(get_resource_access_service),
) -> ListTTSModelsResponse:
    """Return candidate TTS models, optionally from a live endpoint.

    Built-in YAML catalogs are used when ``credential_id`` is omitted,
    or when probing the credential's ``/models`` endpoint fails.

    Args:
        body (ListTTSModelsRequest): The query parameters.
        x_user_id (`str | None`):
            Caller id. Required when ``credential_id`` is set.
        access (`ResourceAccessService`):
            Resolves the credential for a live probe.

    Returns:
        `ListTTSModelsResponse`: The response body.
    """
    credential_cls = CredentialFactory.get_credential_class(body.provider)
    if credential_cls is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{body.provider}' not found.",
        )

    catalog = credential_cls.list_tts_models()

    if body.credential_id:
        if not x_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="X-User-ID header is required.",
            )
        record = await access.resolve_credential(x_user_id, body.credential_id)
        credential = CredentialFactory.from_dict(record.data)
        tts_classes = credential.get_tts_model_classes()
        parameter_class = (
            tts_classes[0].Parameters if tts_classes else None
        )
        if parameter_class is not None:
            live = tts_cards_from_ids(
                await probe_openai_compatible_ids(
                    credential,
                    cache_key=body.credential_id,
                ),
                parameter_class,
            )
            if live:
                catalog = live

    return ListTTSModelsResponse(models=catalog, total=len(catalog))

from pydantic import BaseModel


def model_fields_set(payload: BaseModel) -> set[str]:
    return set(payload.model_fields_set)

import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { CryptoService } from "../../core/crypto.service";
import type { TenantTx } from "../../core/prisma.service";

export interface ContactDto {
  id: string;
  name: string;
  phone: string;
}

/**
 * אדם אמיתי אחד לכל דייר (docs/03 §3): ה-PII מוצפן בכתיבה, phone_hash
 * משמש לזיהוי כפילויות — אותו טלפון לעולם לא יוצר שני אנשים.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly crypto: CryptoService) {}

  async findOrCreateByPhone(
    tx: TenantTx,
    input: { name: string; phone: string },
  ): Promise<ContactDto> {
    const tenantId = TenantContext.current().tenantId;
    const phoneHash = this.crypto.phoneHash(input.phone);

    const existing = await tx.contact.findUnique({
      where: { tenantId_phoneHash: { tenantId, phoneHash } },
      select: { id: true, nameEncrypted: true, phoneEncrypted: true },
    });
    if (existing) {
      return {
        id: existing.id,
        name: this.crypto.decrypt(existing.nameEncrypted),
        phone: this.crypto.decrypt(existing.phoneEncrypted),
      };
    }

    const id = ulid();
    await tx.contact.create({
      data: {
        id,
        tenantId,
        nameEncrypted: this.crypto.encrypt(input.name),
        phoneEncrypted: this.crypto.encrypt(input.phone),
        phoneHash,
      },
    });
    return { id, name: input.name, phone: input.phone };
  }

  async getById(tx: TenantTx, id: string): Promise<ContactDto | null> {
    const row = await tx.contact.findFirst({
      where: { id, tenantId: TenantContext.current().tenantId },
      select: { id: true, nameEncrypted: true, phoneEncrypted: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: this.crypto.decrypt(row.nameEncrypted),
      phone: this.crypto.decrypt(row.phoneEncrypted),
    };
  }
}

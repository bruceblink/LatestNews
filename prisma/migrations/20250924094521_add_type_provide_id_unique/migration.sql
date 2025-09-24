/*
  Warnings:

  - A unique constraint covering the columns `[type,provide_id]` on the table `user_info` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."user_info"
    ADD COLUMN "provide_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_info_type_provide_id_key" ON "public"."user_info" ("type", "provide_id");

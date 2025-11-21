import prisma from '@/app/lib/prisma';
import { DiscountForm } from '@/components/admin/DiscountForm';
import { deleteDiscountCode } from '@/app/actions/admin';
import { format } from 'date-fns';

export default async function DiscountsPage() {
  const discounts = await prisma.discountCode.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Discount Codes</h1>
        <p className="text-zinc-600 mt-2">Manage promotional codes and discounts.</p>
      </div>

      <DiscountForm />

      <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Code</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Value</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Uses</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Expires</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {discounts.map((discount) => (
              <tr key={discount.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900">{discount.code}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">{discount.type}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {discount.type === 'PERCENTAGE' ? `${discount.value}%` : `£${discount.value}`}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {discount.usedCount} / {discount.maxUses || '∞'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {discount.expiresAt ? format(new Date(discount.expiresAt), 'MMM d, yyyy') : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <form action={deleteDiscountCode.bind(null, discount.id)}>
                    <button className="text-red-600 hover:text-red-900">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {discounts.length === 0 && (
                <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-sm text-zinc-500">No discount codes found.</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


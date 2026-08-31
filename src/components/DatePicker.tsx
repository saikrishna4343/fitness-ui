import { addDays, isToday } from 'date-fns'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDayLabel } from '@/lib/format'

/** Day stepper with a calendar pop-out, shared by the food log and the workout page. */
export function DatePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => onChange(addDays(value, -1))}>
        <ChevronLeft className="size-4" />
        <span className="sr-only">Previous day</span>
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-52 gap-2">
            <CalendarIcon className="size-4" />
            {isToday(value) ? 'Today' : formatDayLabel(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value}
            onSelect={(date) => {
              if (date) {
                onChange(date)
                setOpen(false)
              }
            }}
          />
        </PopoverContent>
      </Popover>

      <Button variant="outline" size="icon" onClick={() => onChange(addDays(value, 1))}>
        <ChevronRight className="size-4" />
        <span className="sr-only">Next day</span>
      </Button>
    </div>
  )
}
